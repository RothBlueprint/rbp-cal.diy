/**
 * rbp: covers GET /v2/users/:userId/availability-check. The Django settings page
 * draws a 14-day grid from this and tells an agent WHY each time is or is not
 * bookable in the pool. The answer has to be Cal's own, so these pin that the
 * service asks Cal's UserAvailabilityService twice in the right shapes and
 * labels what comes back without reinterpreting it.
 *
 * Virtual mocks follow users-admin-selected-calendars.spec.ts: the
 * platform-libraries workspace packages cannot be resolved in the Jest unit
 * environment.
 */
jest.mock("@calcom/platform-libraries", () => ({ credentialForCalendarServiceSelect: {} }), {
  virtual: true,
});
jest.mock(
  "@calcom/platform-libraries/schedules",
  () => {
    const dayjs = jest.requireActual("dayjs");
    dayjs.extend(jest.requireActual("dayjs/plugin/utc"));
    return {
      UserAvailabilityService: class {},
      availabilityUserSelect: {},
      dayjs,
      withSelectedCalendars: (user: { selectedCalendars: { eventTypeId: number | null }[] }) => {
        const { selectedCalendars, ...rest } = user;
        return {
          ...rest,
          allSelectedCalendars: selectedCalendars,
          userLevelSelectedCalendars: selectedCalendars.filter((c) => !c.eventTypeId),
        };
      },
    };
  },
  { virtual: true }
);

import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  busyKind,
  UsersAdminAvailabilityService,
} from "@/modules/users/services/users-admin-availability.service";

describe("UsersAdminAvailabilityService", () => {
  const USER_ID = 14;
  const EVENT_TYPE_ID = 4;
  const START = "2026-11-10T05:00:00.000Z";
  const END = "2026-11-24T05:00:00.000Z";

  const eventType = {
    id: EVENT_TYPE_ID,
    length: 60,
    beforeEventBuffer: 15,
    afterEventBuffer: 15,
    minimumBookingNotice: 480,
    slotInterval: 30,
  };
  const userRow = {
    id: USER_ID,
    username: "armar",
    locked: false,
    credentials: [{ id: 24, type: "google_calendar" }],
    selectedCalendars: [{ eventTypeId: null, externalId: "agent@gmail.com" }],
  };
  const hours = [{ start: "2026-11-10T13:00:00.000Z", end: "2026-11-10T22:00:00.000Z" }];

  let getUserAvailability: jest.Mock;
  let findEventType: jest.Mock;
  let findUser: jest.Mock;

  const availability = (over: Record<string, unknown> = {}) => ({
    timeZone: "America/New_York",
    workingHours: [{ days: [2], startTime: 480, endTime: 1020 }],
    oooExcludedDateRanges: hours,
    busy: [],
    ...over,
  });

  const build = () => {
    findEventType = jest.fn().mockResolvedValue(eventType);
    findUser = jest.fn().mockResolvedValue(userRow);
    const svc = Object.create(UsersAdminAvailabilityService.prototype) as Record<string, unknown>;
    svc.dbWrite = { prisma: { eventType: { findUnique: findEventType }, user: { findUnique: findUser } } };
    svc.userAvailabilityService = { getUserAvailability };
    return svc as unknown as UsersAdminAvailabilityService;
  };

  it("labels busy blocks by Cal's source tag", () => {
    expect(busyKind("eventType-4-booking-155")).toBe("booking");
    expect(busyKind("busy_time.calendar")).toBe("calendar");
    expect(busyKind(undefined)).toBe("calendar");
    expect(busyKind("error-placeholder")).toBe("calendar_error");
    expect(busyKind("Event Booking Limit for User: 2 per day")).toBe("limit");
    expect(busyKind("Team Booking Limit: 5 per week")).toBe("limit");
  });

  it("asks once as booked and once for working hours alone", async () => {
    getUserAvailability = jest
      .fn()
      .mockResolvedValueOnce(
        availability({
          oooExcludedDateRanges: [{ start: "2026-11-10T14:15:00.000Z", end: "2026-11-10T15:45:00.000Z" }],
          busy: [
            { start: "2026-11-10T13:15:00.000Z", end: "2026-11-10T14:15:00.000Z", source: "busy_time.calendar" },
            { start: "2026-11-10T15:45:00.000Z", end: "2026-11-10T17:15:00.000Z", source: "eventType-4-booking-9" },
          ],
        })
      )
      .mockResolvedValueOnce(availability());
    const service = build();

    const out = await service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, END);

    const [asBooked, hoursOnly] = getUserAvailability.mock.calls;
    // The real user, with sources, at the pool's length and buffers.
    expect(asBooked[0]).toMatchObject({
      userId: USER_ID,
      eventTypeId: EVENT_TYPE_ID,
      duration: 60,
      beforeEventBuffer: 15,
      afterEventBuffer: 15,
      withSource: true,
      mode: "slots",
    });
    expect(asBooked[1].user.credentials).toEqual(userRow.credentials);
    // No calendars and no bookings: nothing can be busy, so what is left is hours.
    expect(hoursOnly[1].user.credentials).toEqual([]);
    expect(hoursOnly[1].user.userLevelSelectedCalendars).toEqual([]);
    expect(hoursOnly[1].currentBookings).toEqual([]);

    expect(out.calendarError).toBe(false);
    expect(out.timeZone).toBe("America/New_York");
    expect(out.eventType).toEqual({
      id: EVENT_TYPE_ID,
      lengthInMinutes: 60,
      beforeEventBuffer: 15,
      afterEventBuffer: 15,
      minimumBookingNotice: 480,
      slotInterval: 30,
    });
    expect(out.workingHours).toEqual(hours);
    expect(out.free).toEqual([{ start: "2026-11-10T14:15:00.000Z", end: "2026-11-10T15:45:00.000Z" }]);
    expect(out.busy.map((b) => b.kind)).toEqual(["calendar", "booking"]);
  });

  it("reports an unreadable calendar instead of an empty schedule", async () => {
    // getUserAvailability swallows a calendar fetch error and answers with no
    // hours at all; the hours-only call, which reads no calendar, still has them.
    getUserAvailability = jest
      .fn()
      .mockResolvedValueOnce(availability({ workingHours: [], oooExcludedDateRanges: [] }))
      .mockResolvedValueOnce(availability());
    const out = await build().getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, END);

    expect(out.calendarError).toBe(true);
    expect(out.free).toEqual([]);
    expect(out.workingHours).toEqual(hours);
  });

  it("does not call an empty schedule a calendar error", async () => {
    const none = availability({ workingHours: [], oooExcludedDateRanges: [] });
    getUserAvailability = jest.fn().mockResolvedValueOnce(none).mockResolvedValueOnce(none);
    const out = await build().getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, END);

    expect(out.calendarError).toBe(false);
    expect(out.workingHours).toEqual([]);
  });

  it("404s an unknown user or event type", async () => {
    getUserAvailability = jest.fn();
    const service = build();
    findUser.mockResolvedValueOnce(null);
    await expect(service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, END)).rejects.toThrow(
      NotFoundException
    );
    findEventType.mockResolvedValueOnce(null);
    await expect(service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, END)).rejects.toThrow(
      NotFoundException
    );
    expect(getUserAvailability).not.toHaveBeenCalled();
  });

  it("refuses a bad or oversized window before touching the database", async () => {
    getUserAvailability = jest.fn();
    const service = build();
    await expect(service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, "nope", END)).rejects.toThrow(
      BadRequestException
    );
    await expect(service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, END, START)).rejects.toThrow(
      BadRequestException
    );
    await expect(
      service.getAvailabilityCheck(USER_ID, EVENT_TYPE_ID, START, "2027-01-30T00:00:00.000Z")
    ).rejects.toThrow(BadRequestException);
    expect(findUser).not.toHaveBeenCalled();
  });
});
