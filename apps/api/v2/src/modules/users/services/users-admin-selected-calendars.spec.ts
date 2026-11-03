/**
 * rbp: covers the admin-scoped conflict-calendar toggles. The Google connect callback
 * selects only the primary calendar, so an agent with a second calendar in the same
 * account gets booked over it; these routes are how our settings page checks the other
 * one. The case that matters most is the refusal: unchecking a connection's last calendar
 * makes Cal report the agent free at all times.
 *
 * Virtual mocks follow users-admin-calendar-disconnect.spec.ts: the platform-libraries
 * workspace packages cannot be resolved in the Jest unit environment.
 */
jest.mock("@calcom/platform-libraries", () => ({ UserCreationService: {} }), { virtual: true });
jest.mock("@calcom/platform-libraries/app-store", () => ({ handleDeleteCredential: jest.fn() }), {
  virtual: true,
});
jest.mock("googleapis-common", () => ({ OAuth2Client: jest.fn() }));
jest.mock("@googleapis/calendar", () => ({ calendar_v3: { Calendar: jest.fn() } }));

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";

describe("UsersAdminService selected calendars", () => {
  const USER_ID = 32;
  const CREDENTIAL_ID = 39;
  const PRIMARY = "agent@gmail.com";
  const BUSINESS = "c_business@group.calendar.google.com";

  const workingConnection = {
    integration: { type: "google_calendar" },
    credentialId: CREDENTIAL_ID,
    calendars: [{ externalId: PRIMARY }, { externalId: BUSINESS }],
  };

  let selectedRows: { externalId: string }[];
  let tx: { selectedCalendar: Record<string, jest.Mock> };
  let transaction: jest.Mock;
  let getCalendars: jest.Mock;
  let clearCache: jest.Mock;
  let service: UsersAdminService;

  const build = (connectedCalendars: unknown[] = [workingConnection]) => {
    tx = {
      selectedCalendar: {
        findFirst: jest.fn(async ({ where }) => selectedRows.find((r) => r.externalId === where.externalId) ?? null),
        findMany: jest.fn(async () => selectedRows),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    transaction = jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    getCalendars = jest.fn().mockResolvedValue({ connectedCalendars });
    clearCache = jest.fn();

    const svc = Object.create(UsersAdminService.prototype) as Record<string, unknown>;
    svc.usersRepository = { findById: jest.fn().mockResolvedValue({ id: USER_ID }) };
    svc.calendarsService = { getCalendars };
    svc.calendarsCacheService = { deleteConnectedAndDestinationCalendarsCache: clearCache };
    svc.dbWrite = { prisma: { $transaction: transaction } };
    return svc as unknown as UsersAdminService;
  };

  beforeEach(() => {
    selectedRows = [{ externalId: PRIMARY }];
    service = build();
  });

  describe("add", () => {
    it("checks a second calendar at user level, typed from the connection", async () => {
      await service.addUserSelectedCalendar(USER_ID, CREDENTIAL_ID, BUSINESS);

      expect(getCalendars).toHaveBeenCalledWith(USER_ID);
      expect(tx.selectedCalendar.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          integration: "google_calendar",
          externalId: BUSINESS,
          credentialId: CREDENTIAL_ID,
          eventTypeId: null,
        },
      });
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      expect(clearCache).toHaveBeenCalledWith(USER_ID);
    });

    it("is a no-op when the calendar is already checked", async () => {
      await service.addUserSelectedCalendar(USER_ID, CREDENTIAL_ID, PRIMARY);

      expect(tx.selectedCalendar.create).not.toHaveBeenCalled();
    });

    it("cannot reach a credential that is not this user's", async () => {
      // getCalendars lists only the target user's connections, so a foreign id is absent.
      await expect(service.addUserSelectedCalendar(USER_ID, 999, BUSINESS)).rejects.toThrow(
        NotFoundException
      );
      expect(transaction).not.toHaveBeenCalled();
    });

    it("refuses a calendar id the connection does not list", async () => {
      // Saved, it would match nothing at free/busy time: a checkbox that protects nobody.
      await expect(
        service.addUserSelectedCalendar(USER_ID, CREDENTIAL_ID, "someone-else@gmail.com")
      ).rejects.toThrow(NotFoundException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it("refuses a broken connection", async () => {
      service = build([
        {
          integration: { type: "google_calendar" },
          credentialId: CREDENTIAL_ID,
          error: { message: "Could not get connected calendars" },
        },
      ]);

      await expect(service.addUserSelectedCalendar(USER_ID, CREDENTIAL_ID, BUSINESS)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("remove", () => {
    it("unchecks one calendar while another stays checked", async () => {
      selectedRows = [{ externalId: PRIMARY }, { externalId: BUSINESS }];

      await service.removeUserSelectedCalendar(USER_ID, CREDENTIAL_ID, PRIMARY);

      expect(tx.selectedCalendar.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, integration: "google_calendar", externalId: PRIMARY, eventTypeId: null },
      });
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      expect(clearCache).toHaveBeenCalledWith(USER_ID);
    });

    it("refuses to uncheck the last checked calendar", async () => {
      // With none checked, getCalendarsEvents skips the credential and the agent is free all day.
      await expect(service.removeUserSelectedCalendar(USER_ID, CREDENTIAL_ID, PRIMARY)).rejects.toThrow(
        ConflictException
      );
      expect(tx.selectedCalendar.deleteMany).not.toHaveBeenCalled();
      expect(clearCache).not.toHaveBeenCalled();
    });

    it("does not count a leftover row for a calendar the account cannot see", async () => {
      // e.g. a row from an earlier connection. It protects nothing, so it can't be the one
      // that "remains".
      selectedRows = [{ externalId: PRIMARY }, { externalId: "gone@group.calendar.google.com" }];

      await expect(service.removeUserSelectedCalendar(USER_ID, CREDENTIAL_ID, PRIMARY)).rejects.toThrow(
        ConflictException
      );
      expect(tx.selectedCalendar.deleteMany).not.toHaveBeenCalled();
    });

    it("is a no-op when the calendar is already unchecked", async () => {
      await service.removeUserSelectedCalendar(USER_ID, CREDENTIAL_ID, BUSINESS);

      expect(tx.selectedCalendar.deleteMany).not.toHaveBeenCalled();
      expect(clearCache).not.toHaveBeenCalled();
    });
  });
});
