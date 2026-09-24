import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { withSelectedCalendars } from "@calcom/features/users/repositories/UserRepository";
import type { PrismaClient } from "@calcom/prisma";
import prisma, { userSelect } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import { FilterHostsService } from "./filterHostsBySameRoundRobinHost";

let cachedService: FilterHostsService | undefined;

function getFilterHostsService(): FilterHostsService {
  cachedService ??= new FilterHostsService({ bookingRepo: new BookingRepository(prisma) });
  return cachedService;
}

function filterHostsToOriginalRoundRobinHost<
  T extends { isFixed: false; user: { id: number; email: string } },
>({ hosts, rescheduleUid }: { hosts: T[]; rescheduleUid: string }): Promise<T[]> {
  return getFilterHostsService().filterHostsBySameRoundRobinHost({
    hosts,
    rescheduleUid,
    rescheduleWithSameRoundRobinHost: true,
    // Upstream lets `cal.routedTeamMemberIds` on a reschedule URL switch this
    // filter off (see `isRerouting`), because upstream reads that combination as
    // "staff re-ran the routing form and means to move the host".
    //
    // We use that same parameter for same-state PREFERENCE on new bookings, and
    // it rides on a URL the client holds and could keep, copy or edit. Under our
    // pairing rule only an admin may move an agent off a client, so rerouting is
    // never inferred here — it is passed as null on purpose.
    routedTeamMemberIds: null,
  });
}

/**
 * The agent hosting the booking being rescheduled, loaded from the booking
 * itself rather than from the event type's host list — in the same shape
 * `getEventTypesFromDB` gives a host's user, so it can stand in for one.
 *
 * Returns null when there is no pairing this fork should hold onto:
 *
 * - the booking has no host, or belongs to a different event type. The uid
 *   arrives on a request, so without the event-type check a crafted
 *   `rescheduleUid` could put any team member onto this event type.
 * - the host is no longer an accepted member of the team. Leaving the TEAM is
 *   an admin act, and admins are the one sanctioned way a pairing moves.
 *   Leaving the POOL is not: rbp drops an agent from the hosts list
 *   automatically when their paid appointments run out, and that must not
 *   hand their existing clients to someone else.
 */
export async function findOriginalRoundRobinHost({
  prismaClient,
  rescheduleUid,
  eventTypeId,
  teamId,
}: {
  prismaClient: PrismaClient;
  rescheduleUid: string;
  eventTypeId: number;
  teamId: number;
}) {
  const booking = await prismaClient.booking.findFirst({
    where: {
      uid: rescheduleUid,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.CANCELLED, BookingStatus.PENDING] },
    },
    select: { userId: true, eventTypeId: true },
  });
  if (!booking?.userId || booking.eventTypeId !== eventTypeId) return null;

  const membership = await prismaClient.membership.findFirst({
    where: { userId: booking.userId, teamId, accepted: true },
    select: { id: true },
  });
  if (!membership) return null;

  const user = await prismaClient.user.findUnique({
    where: { id: booking.userId },
    select: {
      credentials: { select: credentialForCalendarServiceSelect },
      ...userSelect,
    },
  });
  return user ? withSelectedCalendars(user) : null;
}

export type OriginalRoundRobinHost = NonNullable<Awaited<ReturnType<typeof findOriginalRoundRobinHost>>>;

/**
 * Narrow a round robin reschedule to the agent already on the meeting — whether
 * or not that agent is still among `hosts`.
 *
 * Try `hosts` first; when the agent is not in it, load them from the booking and
 * return them via `toHost`. They are missing from `hosts` in two everyday cases
 * that must NOT move the client, and moving the client is exactly what the old
 * "empty result means fall through" rule did in both:
 *
 * - they left the pool — rbp removes an agent from the hosts list the moment
 *   their paid appointments are delivered, while their clients' meetings are
 *   still ahead (prod 2026-09-24: agent 1160 hit 10/10, and a client
 *   rescheduling 13 hours later was redrawn onto agent 844);
 * - routing narrowed the list — the booking path applies
 *   `cal.routedTeamMemberIds` (same-state preference) before this runs.
 *
 * Returns [] only when {@link findOriginalRoundRobinHost} finds no pairing to
 * keep; callers then keep their full list.
 *
 * ONE definition, called from both places that decide who may host, because
 * they have to agree. Slot generation (`di/modules/QualifiedHosts`) picks what
 * the booker is offered; `loadAndValidateUsers` picks who actually gets
 * assigned. If they disagree the booker offers a time and assignment hands it
 * to a different agent — which is the precise failure this exists to stop.
 */
export async function keepOriginalRoundRobinHost<
  T extends { isFixed: false; user: { id: number; email: string } },
>({
  hosts,
  rescheduleUid,
  eventTypeId,
  teamId,
  toHost,
}: {
  hosts: T[];
  rescheduleUid: string;
  eventTypeId: number;
  teamId: number | null;
  toHost: (user: OriginalRoundRobinHost) => T;
}): Promise<T[]> {
  const inHosts = await filterHostsToOriginalRoundRobinHost({ hosts, rescheduleUid });
  if (inHosts.length || !teamId) return inHosts;

  const original = await findOriginalRoundRobinHost({
    prismaClient: prisma,
    rescheduleUid,
    eventTypeId,
    teamId,
  });
  return original ? [toHost(original)] : [];
}
