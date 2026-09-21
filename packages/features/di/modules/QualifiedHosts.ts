import { filterHostsToOriginalRoundRobinHost } from "@calcom/features/bookings/lib/host-filtering/getFilterHostsService";

import { createModule } from "../di";
import { DI_TOKENS } from "../tokens";

type Host = {
  isFixed: boolean;
  user: Record<string, unknown>;
  groupId?: string | null;
};

type User = Record<string, unknown>;

type QualifiedHost = { user: Record<string, unknown>; isFixed?: boolean; groupId?: string | null };

export const qualifiedHostsModule = createModule();
qualifiedHostsModule.bind(DI_TOKENS.QUALIFIED_HOSTS_SERVICE).toValue({
  findQualifiedHostsWithDelegationCredentials: async (...args: unknown[]) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    const eventType = (input.eventType ?? {}) as Record<string, unknown>;
    const contactOwnerEmail = input.contactOwnerEmail as string | null | undefined;
    const routedTeamMemberIds = (input.routedTeamMemberIds ?? []) as number[];
    const rescheduleUid = (input.rescheduleUid ?? null) as string | null;
    const rescheduleWithSameRoundRobinHost = Boolean(eventType.rescheduleWithSameRoundRobinHost);

    const hosts = (eventType.hosts ?? []) as Host[];
    const users = (eventType.users ?? []) as User[];
    const schedulingType = eventType.schedulingType as string | null | undefined;

    // For team events with hosts array
    if (hosts.length > 0) {
      const fixedHosts: QualifiedHost[] = [];
      const allRRHosts: QualifiedHost[] = [];

      for (const host of hosts) {
        const qualifiedHost: QualifiedHost = {
          user: host.user,
          isFixed: host.isFixed,
          groupId: host.groupId ?? null,
        };

        if (host.isFixed || schedulingType !== "ROUND_ROBIN") {
          fixedHosts.push(qualifiedHost);
        } else {
          allRRHosts.push(qualifiedHost);
        }
      }

      // Filter qualifiedRRHosts based on contactOwnerEmail or routedTeamMemberIds
      let qualifiedRRHosts = allRRHosts;

      if (contactOwnerEmail) {
        const contactOwnerHost = allRRHosts.filter(
          (h) => (h.user as { email?: string }).email === contactOwnerEmail
        );
        if (contactOwnerHost.length > 0) {
          qualifiedRRHosts = contactOwnerHost;
        }
      } else if (routedTeamMemberIds.length > 0) {
        const routedMemberIdSet = new Set(routedTeamMemberIds);
        const routedHosts = allRRHosts.filter((h) => routedMemberIdSet.has((h.user as { id: number }).id));
        if (routedHosts.length > 0) {
          qualifiedRRHosts = routedHosts;
        }
      }

      // The pairing rule outranks routing preference, so this runs last and
      // filters `allRRHosts` rather than the narrowed set — the agent already
      // on the meeting need not be in the routed subset.
      if (rescheduleUid && schedulingType === "ROUND_ROBIN" && rescheduleWithSameRoundRobinHost) {
        const sameHostOnly = await filterHostsToOriginalRoundRobinHost({
          hosts: allRRHosts.map((host) => ({
            isFixed: false as const,
            user: host.user as { id: number; email: string },
            host,
          })),
          rescheduleUid,
          rescheduleWithSameRoundRobinHost: true,
        });
        if (sameHostOnly.length) {
          return {
            qualifiedRRHosts: sameHostOnly.map((entry) => entry.host),
            // Deliberately empty. Cal widens to `allFallbackRRHosts` when the
            // qualified host has no opening inside two weeks, and that widening
            // is precisely how a rescheduling client lands on a stranger.
            allFallbackRRHosts: [],
            fixedHosts,
          };
        }
      }

      return { qualifiedRRHosts, allFallbackRRHosts: allRRHosts, fixedHosts };
    }

    // For user events (no hosts, just users array)
    if (users.length > 0) {
      const fixedHosts = users.map((user) => ({
        user,
        isFixed: true as const,
        groupId: null,
      }));
      return { qualifiedRRHosts: [], allFallbackRRHosts: [], fixedHosts };
    }

    return { qualifiedRRHosts: [], allFallbackRRHosts: [], fixedHosts: [] };
  },
});
