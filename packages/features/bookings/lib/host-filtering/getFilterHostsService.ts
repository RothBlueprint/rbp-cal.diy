import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import prisma from "@calcom/prisma";

import { FilterHostsService } from "./filterHostsBySameRoundRobinHost";

let cachedService: FilterHostsService | undefined;

function getFilterHostsService(): FilterHostsService {
  cachedService ??= new FilterHostsService({ bookingRepo: new BookingRepository(prisma) });
  return cachedService;
}

/**
 * Narrow a round robin's hosts to the one already hosting the booking being
 * rescheduled. Returns the input untouched when this is not that case.
 *
 * ONE definition, called from both places that decide who may host, because
 * they have to agree. Slot generation (`di/modules/QualifiedHosts`) picks what
 * the booker is offered; `loadAndValidateUsers` picks who actually gets
 * assigned. If they disagree the booker offers a time and assignment hands it
 * to a different agent — which is the precise failure this exists to stop.
 */
export async function filterHostsToOriginalRoundRobinHost<
  T extends { isFixed: false; user: { id: number; email: string } },
>({
  hosts,
  rescheduleUid,
  rescheduleWithSameRoundRobinHost,
}: {
  hosts: T[];
  rescheduleUid: string | null;
  rescheduleWithSameRoundRobinHost: boolean;
}): Promise<T[]> {
  return getFilterHostsService().filterHostsBySameRoundRobinHost({
    hosts,
    rescheduleUid,
    rescheduleWithSameRoundRobinHost,
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
