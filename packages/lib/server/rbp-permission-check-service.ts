import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

/**
 * RBP: a real PermissionCheckService.
 *
 * WHAT WAS WRONG
 * --------------
 * The cal.diy refactor replaced the commercial PBAC service with a stub that
 * returned `true` from every check, declared locally in eighteen files:
 *
 *     class PermissionCheckService {
 *       async checkPermission(..._args: unknown[]) { return true; }
 *     }
 *
 * So every guard in the codebase passed for everybody. The call sites look
 * protective and read as though they work —
 *
 *     createEventPbacProcedure("eventType.update", [MembershipRole.ADMIN, MembershipRole.OWNER])
 *
 * — but `fallbackRoles` was threaded all the way down and then discarded. In
 * practice any team MEMBER could update or delete any team event type. For rbp
 * that means one agent could change the shared round-robin event type's slug and
 * break every homepage booking at once, or delete it outright.
 *
 * This is the shape UPSTREAM-BUGS.md opens with: stubs that silently succeed, so
 * a feature looks wired up and quietly does nothing. This one failed OPEN.
 *
 * WHAT THIS DOES
 * --------------
 * PBAC proper (custom roles per team) is the commercial feature and is not coming
 * back here. But every call site already passes `fallbackRoles` — the roles that
 * should be accepted when PBAC is unavailable — so the correct non-PBAC behaviour
 * is fully specified by the callers. This honours exactly that and nothing more.
 *
 * Org membership is consulted as well: in cal's model an ADMIN or OWNER of a
 * parent organisation administers its sub-teams, so a check against a child team
 * has to accept the org-level role. We run no organisations today, which makes
 * that branch dead code here — but it is what the callers mean, and quietly
 * dropping it would be the same class of mistake as the stub.
 *
 * FAILS CLOSED. No membership, no team, no user: false. The stub's habit of
 * answering `true` when it did not know is the entire bug.
 */

type Role = MembershipRole;

const DEFAULT_ROLES: Role[] = [MembershipRole.ADMIN, MembershipRole.OWNER];

type CheckArgs = {
  userId?: number | null;
  teamId?: number | null;
  permission?: string;
  fallbackRoles?: Role[];
};

type TeamIdsArgs = {
  userId?: number | null;
  permission?: string;
  fallbackRoles?: Role[];
  /**
   * Scope the answer to one organisation: the org itself and the teams beneath
   * it. Callers pass this to bound what a query may reach (bookings/get.handler
   * uses it to decide which teams' bookings are visible), so dropping it would
   * hand back teams outside the org and widen exactly what it was narrowing.
   */
  orgId?: number | null;
};

export class PermissionCheckService {
  constructor(_prisma?: unknown) {}

  /**
   * True when ``userId`` holds one of ``fallbackRoles`` on ``teamId`` — directly,
   * or through the team's parent organisation.
   */
  async checkPermission({ userId, teamId, fallbackRoles }: CheckArgs = {}): Promise<boolean> {
    if (!userId || !teamId) return false;

    const roles = fallbackRoles?.length ? fallbackRoles : DEFAULT_ROLES;

    const direct = await prisma.membership.findFirst({
      where: { userId, teamId, accepted: true },
      select: { role: true },
    });
    if (direct && roles.includes(direct.role)) return true;

    // Parent-org administrators administer sub-teams.
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { parentId: true },
    });
    if (!team?.parentId) return false;

    const viaOrg = await prisma.membership.findFirst({
      where: { userId, teamId: team.parentId, accepted: true },
      select: { role: true },
    });
    if (!viaOrg) return false;

    // Only org ADMIN/OWNER inherit downwards — a plain org member does not become
    // an administrator of every team inside it.
    return (
      (viaOrg.role === MembershipRole.ADMIN || viaOrg.role === MembershipRole.OWNER) &&
      roles.includes(viaOrg.role)
    );
  }

  /** Alias kept because both names are called across the codebase. */
  async hasPermission(args: CheckArgs = {}): Promise<boolean> {
    return this.checkPermission(args);
  }

  /**
   * Team ids where ``userId`` holds one of ``fallbackRoles``.
   *
   * The stub returned `[]`, which was restrictive rather than permissive — the
   * one place its failure mode ran the safe way. Callers use this to decide which
   * teams to show, so returning real ids WIDENS what people see. That is correct
   * upstream behaviour; rbp narrows it separately and deliberately (see
   * rbp-team-visibility), rather than by lying here about who holds what role.
   */
  async getTeamIdsWithPermission({
    userId,
    fallbackRoles,
    orgId,
  }: TeamIdsArgs = {}): Promise<number[]> {
    if (!userId) return [];

    const roles = fallbackRoles?.length ? fallbackRoles : DEFAULT_ROLES;

    const memberships = await prisma.membership.findMany({
      where: {
        userId,
        accepted: true,
        role: { in: roles },
        // Scoped to the org and its sub-teams when asked. Without this the
        // caller gets teams it never asked about — the opposite of what passing
        // an orgId means.
        ...(orgId ? { team: { OR: [{ id: orgId }, { parentId: orgId }] } } : {}),
      },
      select: { teamId: true },
    });

    return memberships.map((m) => m.teamId);
  }
}

/**
 * RBP POLICY, not a permission fix: may this user see a team's event types at all?
 *
 * Upstream lets any team MEMBER read team event types, and with the stub replaced
 * that is once again what `eventType.read` means. rbp wants less than that.
 *
 * Agents are members of one shared team — the round-robin pool — purely so they
 * can be hosts on it. The event type itself is infrastructure: its slug is baked
 * into the URL rbp sends every homepage lead to, and its hosts are managed by
 * rbp's reconciliation. An agent has no reason to open it, and every reason not
 * to. They cannot edit it any more, but a settings page you can read and not save
 * is an invitation to try.
 *
 * Deliberately separate from checkPermission: this is a product decision about
 * what agents should see, not a claim about what role they hold. Encoding it as a
 * role lie would make every other permission answer wrong too.
 */
export async function rbpCanAccessTeamEventTypes(
  userId?: number | null,
  teamId?: number | null
): Promise<boolean> {
  if (!teamId) return true; // personal event types are always the user's own
  return new PermissionCheckService().checkPermission({
    userId,
    teamId,
    permission: "eventType.read",
    fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
  });
}

/**
 * Resource permissions for one team, in the shape the event-type UI expects.
 *
 * Replaces a stub that answered `{canCreate: true, canEdit: true, canDelete: true,
 * canRead: true}` for everyone. Each caller supplies the roles that should be
 * accepted per action, so this is again just honouring what they already say.
 */
export async function getResourcePermissions({
  userId,
  teamId,
  fallbackRoles,
}: {
  userId?: number | null;
  teamId?: number | null;
  userRole?: Role;
  resource?: unknown;
  fallbackRoles?: {
    read?: { roles: Role[] };
    create?: { roles: Role[] };
    update?: { roles: Role[] };
    delete?: { roles: Role[] };
  };
} = {}): Promise<{
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRead: boolean;
}> {
  const service = new PermissionCheckService();

  const allowed = async (roles?: Role[]) =>
    roles?.length ? service.checkPermission({ userId, teamId, fallbackRoles: roles }) : false;

  const [canRead, canCreate, canEdit, canDelete] = await Promise.all([
    allowed(fallbackRoles?.read?.roles),
    allowed(fallbackRoles?.create?.roles),
    allowed(fallbackRoles?.update?.roles),
    allowed(fallbackRoles?.delete?.roles),
  ]);

  return { canRead, canCreate, canEdit, canDelete };
}
