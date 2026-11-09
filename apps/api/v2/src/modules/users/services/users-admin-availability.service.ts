import { credentialForCalendarServiceSelect } from "@calcom/platform-libraries";
import { availabilityUserSelect, dayjs, withSelectedCalendars } from "@calcom/platform-libraries/schedules";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { UserAvailabilityService } from "@/lib/services/user-availability.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

/** Longest window one call may ask about. The Django page asks for 14 days. */
export const MAX_AVAILABILITY_CHECK_DAYS = 31;

/**
 * What a busy block is, from Cal's `source` tag:
 *
 * - `booking`: a Cal booking of theirs (`eventType-<id>-booking-<id>`).
 * - `limit`: a booking or duration limit is used up (limitManager's sources).
 * - `calendar_error`: the calendar could not be read. Cal fails closed and
 *   blocks the whole window with one `error-placeholder` block.
 * - `calendar`: everything else, i.e. a busy time from their connected
 *   calendar (`busy_time.calendar`, or a provider's own tag).
 */
export type BusyKind = "booking" | "limit" | "calendar_error" | "calendar";

export function busyKind(source: string | undefined | null): BusyKind {
  if (!source) return "calendar";
  if (source.startsWith("eventType-")) return "booking";
  if (source === "error-placeholder") return "calendar_error";
  if (source.includes("Limit")) return "limit";
  return "calendar";
}

type Range = { start: unknown; end: unknown };

const iso = (value: unknown) => dayjs(value as string).toISOString();
const isoRange = (r: Range) => ({ start: iso(r.start), end: iso(r.end) });

/**
 * rbp: why a user can or cannot be booked on an event type, for a settings page
 * to draw.
 *
 * The agent's own booking page cannot answer this. It is their personal event
 * type, with its own length and buffers, while pool leads book the team
 * round-robin event. An agent whose calendar left hour-long gaps saw open times
 * there every weekday and was never bookable in the pool, which needs 90
 * minutes (agent 1048, 2026-11). The slots endpoints cannot answer it either:
 * they only filter to a user who is a host right now, and an agent who is
 * paused, capped or still setting up is not.
 *
 * So this runs Cal's own UserAvailabilityService on the user directly, against
 * the event type's length and buffers, twice:
 *
 * 1. **As booked**: the exact call the booking path makes. `free` is what is
 *    left after busy time (already widened by the buffers), and `busy` is each
 *    block with its source.
 * 2. **Hours only**: the same user with no calendar credentials and no bookings,
 *    so busy time is empty and `workingHours` is their schedule (minus
 *    out-of-office) and nothing else.
 *
 * The caller works out each slot's reason from those three lists, in the same
 * terms Cal uses: outside `workingHours`, or inside it but not inside `free`
 * because of the `busy` block that overlaps.
 */
@Injectable()
export class UsersAdminAvailabilityService {
  constructor(
    private readonly dbWrite: PrismaWriteService,
    private readonly userAvailabilityService: UserAvailabilityService
  ) {}

  async getAvailabilityCheck(userId: number, eventTypeId: number, start: string, end: string) {
    const dateFrom = dayjs(start);
    const dateTo = dayjs(end);
    if (!start || !end || !dateFrom.isValid() || !dateTo.isValid() || !dateTo.isAfter(dateFrom)) {
      throw new BadRequestException("start and end must be ISO datetimes with end after start");
    }
    if (dateTo.diff(dateFrom, "day", true) > MAX_AVAILABILITY_CHECK_DAYS) {
      throw new BadRequestException(`The window can be at most ${MAX_AVAILABILITY_CHECK_DAYS} days`);
    }

    const eventType = await this.dbWrite.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: {
        id: true,
        length: true,
        beforeEventBuffer: true,
        afterEventBuffer: true,
        minimumBookingNotice: true,
        slotInterval: true,
      },
    });
    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }

    // The same shape the slots path loads a host with (eventTypeRepository's
    // hosts select): availabilityUserSelect plus calendar credentials.
    const row = await this.dbWrite.prisma.user.findUnique({
      where: { id: userId },
      select: {
        locked: true,
        credentials: { select: credentialForCalendarServiceSelect },
        ...availabilityUserSelect,
      },
    });
    if (!row) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    const user = withSelectedCalendars(row);

    const query = {
      userId,
      username: user.username ?? undefined,
      dateFrom,
      dateTo,
      eventTypeId,
      duration: eventType.length,
      beforeEventBuffer: eventType.beforeEventBuffer,
      afterEventBuffer: eventType.afterEventBuffer,
      returnDateOverrides: false,
      mode: "slots" as const,
    };

    const asBooked = await this.userAvailabilityService.getUserAvailability(
      { ...query, withSource: true },
      { user }
    );
    const hoursOnly = await this.userAvailabilityService.getUserAvailability(query, {
      user: { ...user, credentials: [], allSelectedCalendars: [], userLevelSelectedCalendars: [] },
      currentBookings: [],
    });

    // A calendar read that throws is caught inside getUserAvailability, which
    // then answers "no availability at all" with no working hours. Told apart
    // from a genuinely empty schedule by the hours-only call, which reads no
    // calendar: if IT has hours and the real call has none, the calendar failed.
    const calendarError =
      asBooked.workingHours.length === 0 &&
      hoursOnly.workingHours.length > 0 &&
      asBooked.oooExcludedDateRanges.length === 0;

    return {
      timeZone: asBooked.timeZone || hoursOnly.timeZone,
      eventType: {
        id: eventType.id,
        lengthInMinutes: eventType.length,
        beforeEventBuffer: eventType.beforeEventBuffer,
        afterEventBuffer: eventType.afterEventBuffer,
        minimumBookingNotice: eventType.minimumBookingNotice,
        slotInterval: eventType.slotInterval,
      },
      calendarError,
      workingHours: hoursOnly.oooExcludedDateRanges.map(isoRange),
      free: calendarError ? [] : asBooked.oooExcludedDateRanges.map(isoRange),
      // Widened by the buffers, as Cal uses them. A calendar block is widened by
      // afterEventBuffer before it and beforeEventBuffer after it (getBusyTimes).
      busy: asBooked.busy.map((b) => ({ ...isoRange(b), kind: busyKind(b.source) })),
    };
  }
}
