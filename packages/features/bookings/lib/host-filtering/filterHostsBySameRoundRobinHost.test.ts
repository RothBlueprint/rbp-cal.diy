import { describe, it, expect } from "vitest";

import { FilterHostsService } from "./filterHostsBySameRoundRobinHost";

const ORIGINAL_HOST = { id: 11, email: "robert@rlbfinancial.com" };
const OTHER_HOST = { id: 4, email: "matt3asu@gmail.com" };

const hosts = [
  { isFixed: false as const, user: ORIGINAL_HOST },
  { isFixed: false as const, user: OTHER_HOST },
];

function serviceReturning(booking: { userId: number; attendees: { email: string }[] } | null) {
  return new FilterHostsService({
    bookingRepo: {
      findOriginalRescheduledBookingUserId: async () => booking,
    },
  } as unknown as ConstructorParameters<typeof FilterHostsService>[0]);
}

const originalBooking = { userId: ORIGINAL_HOST.id, attendees: [{ email: "client@example.com" }] };

describe("filterHostsBySameRoundRobinHost", () => {
  it("leaves a fresh booking alone — there is no pairing to keep yet", async () => {
    const result = await serviceReturning(originalBooking).filterHostsBySameRoundRobinHost({
      hosts,
      rescheduleUid: null,
      rescheduleWithSameRoundRobinHost: true,
      routedTeamMemberIds: null,
    });

    expect(result).toEqual(hosts);
  });

  it("narrows a reschedule to the agent already on the meeting", async () => {
    const result = await serviceReturning(originalBooking).filterHostsBySameRoundRobinHost({
      hosts,
      rescheduleUid: "vFesa9Dk2sE12TvXgdDoAn",
      rescheduleWithSameRoundRobinHost: true,
      routedTeamMemberIds: null,
    });

    expect(result.map((host) => host.user.id)).toEqual([ORIGINAL_HOST.id]);
  });

  it("falls through when the original host has left the event type", async () => {
    const result = await serviceReturning({ userId: 999, attendees: [] }).filterHostsBySameRoundRobinHost(
      {
        hosts,
        rescheduleUid: "vFesa9Dk2sE12TvXgdDoAn",
        rescheduleWithSameRoundRobinHost: true,
        routedTeamMemberIds: null,
      }
    );

    // Empty, so callers keep the full list rather than make the reschedule
    // unfulfillable. Only an admin can remove a host, which is the one
    // sanctioned way a pairing moves.
    expect(result).toEqual([]);
  });

  it("is disabled by routedTeamMemberIds — which is why callers pass null", async () => {
    // Upstream reads rescheduleUid + routedTeamMemberIds as "staff re-ran the
    // routing form". We use that parameter for same-state preference on a URL
    // the client holds, so `filterHostsToOriginalRoundRobinHost` never forwards
    // it. This test pins the upstream behaviour that makes that necessary: if
    // it ever stops disabling the filter, the wrapper's null can be revisited.
    const result = await serviceReturning(originalBooking).filterHostsBySameRoundRobinHost({
      hosts,
      rescheduleUid: "vFesa9Dk2sE12TvXgdDoAn",
      rescheduleWithSameRoundRobinHost: true,
      routedTeamMemberIds: [OTHER_HOST.id],
    });

    expect(result).toEqual(hosts);
  });

  it("does nothing when the event type has the setting off", async () => {
    const result = await serviceReturning(originalBooking).filterHostsBySameRoundRobinHost({
      hosts,
      rescheduleUid: "vFesa9Dk2sE12TvXgdDoAn",
      rescheduleWithSameRoundRobinHost: false,
      routedTeamMemberIds: null,
    });

    expect(result).toEqual(hosts);
  });
});
