/**
 * rbp: covers the admin-scoped calendar disconnect — the route that exists because the
 * user-scoped POST /v2/calendars/:calendar/disconnect resolves the credential against the API
 * key's OWNER, so every agent disconnect made with our single admin key 404'd.
 *
 * Virtual mocks for the @calcom/platform-libraries workspace packages follow the pattern in
 * cal-unified-calendars/services/google-calendar.service.spec.ts: their transitive deps
 * (prisma, DB connections) cannot be resolved in the Jest unit environment.
 */
const mockHandleDeleteCredential = jest.fn();
jest.mock("@calcom/platform-libraries", () => ({ UserCreationService: {} }), { virtual: true });
jest.mock(
  "@calcom/platform-libraries/app-store",
  () => ({ handleDeleteCredential: mockHandleDeleteCredential }),
  { virtual: true }
);
jest.mock("googleapis-common", () => ({ OAuth2Client: jest.fn() }));
jest.mock("@googleapis/calendar", () => ({ calendar_v3: { Calendar: jest.fn() } }));

import { GOOGLE_CALENDAR_TYPE, OFFICE_365_CALENDAR_TYPE } from "@calcom/platform-constants";
import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";

describe("UsersAdminService.disconnectUserCalendar", () => {
  // The key we authenticate with is owned by user 1; the stuck calendar belongs to user 6.
  // That mismatch is the entire reason this route exists.
  const TARGET_USER_ID = 6;
  const googleCredential = { id: 11, type: GOOGLE_CALENDAR_TYPE, key: { refresh_token: "rt" } };

  let calls: string[];
  let findAllCredentialsByTypeAndUserId: jest.Mock;
  let revokeGrant: jest.Mock;
  let deleteConnectedAndDestinationCalendarsCache: jest.Mock;
  let findByIdWithProfile: jest.Mock;
  let service: UsersAdminService;

  const buildService = (credentials: unknown[]) => {
    calls = [];
    findByIdWithProfile = jest.fn().mockResolvedValue({ id: TARGET_USER_ID, metadata: {} });
    findAllCredentialsByTypeAndUserId = jest.fn().mockResolvedValue(credentials);
    revokeGrant = jest.fn().mockImplementation(async () => {
      calls.push("revoke");
    });
    mockHandleDeleteCredential.mockImplementation(async () => {
      calls.push("delete");
    });
    deleteConnectedAndDestinationCalendarsCache = jest.fn();

    // Only the deps this method touches are real mocks; the rest are unused constructor slots.
    const svc = Object.create(UsersAdminService.prototype) as Record<string, unknown>;
    svc.usersRepository = { findByIdWithProfile };
    svc.credentialsRepository = { findAllCredentialsByTypeAndUserId };
    svc.googleCalendarService = { revokeGrant };
    svc.calendarsCacheService = { deleteConnectedAndDestinationCalendarsCache };
    return svc as unknown as UsersAdminService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService([googleCredential]);
  });

  it("scopes the credential lookup to the :userId path param, not the API key owner", async () => {
    await service.disconnectUserCalendar(TARGET_USER_ID, "google");

    expect(findAllCredentialsByTypeAndUserId).toHaveBeenCalledWith(GOOGLE_CALENDAR_TYPE, TARGET_USER_ID);
  });

  it("cannot touch a credential belonging to another user", async () => {
    // The scoped query simply does not return another user's row.
    service = buildService([]);

    await expect(service.disconnectUserCalendar(TARGET_USER_ID, "google")).rejects.toThrow(
      NotFoundException
    );
    expect(mockHandleDeleteCredential).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it("revokes the grant before deleting the row", async () => {
    await service.disconnectUserCalendar(TARGET_USER_ID, "google");

    // Delete-first would lose the refresh token with the row and strand a live grant.
    expect(calls).toEqual(["revoke", "delete"]);
    expect(revokeGrant).toHaveBeenCalledWith(googleCredential.key);
  });

  it("aborts before deleting when the revoke genuinely fails", async () => {
    revokeGrant.mockRejectedValue(new ServiceUnavailableException("google unreachable"));

    await expect(service.disconnectUserCalendar(TARGET_USER_ID, "google")).rejects.toThrow(
      ServiceUnavailableException
    );

    // Row survives, so the settings page keeps its Disconnect button and a retry costs nothing.
    expect(mockHandleDeleteCredential).not.toHaveBeenCalled();
  });

  it("never revokes for office365 but still deletes the credential", async () => {
    service = buildService([{ id: 12, type: OFFICE_365_CALENDAR_TYPE, key: { refresh_token: "rt" } }]);

    await service.disconnectUserCalendar(TARGET_USER_ID, "office365");

    expect(revokeGrant).not.toHaveBeenCalled();
    expect(mockHandleDeleteCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET_USER_ID, credentialId: 12 })
    );
  });

  it("revokes every google credential, so no second grant is left listed", async () => {
    service = buildService([
      googleCredential,
      { id: 12, type: GOOGLE_CALENDAR_TYPE, key: { refresh_token: "rt2" } },
    ]);

    await service.disconnectUserCalendar(TARGET_USER_ID, "google");

    expect(revokeGrant).toHaveBeenCalledTimes(2);
    expect(mockHandleDeleteCredential).toHaveBeenCalledTimes(2);
  });

  it("busts the connected-calendars cache so the removed calendar stops being served", async () => {
    await service.disconnectUserCalendar(TARGET_USER_ID, "google");

    expect(deleteConnectedAndDestinationCalendarsCache).toHaveBeenCalledWith(TARGET_USER_ID);
  });

  it("rejects an unknown calendar slug before touching anything", async () => {
    await expect(service.disconnectUserCalendar(TARGET_USER_ID, "apple")).rejects.toThrow(
      BadRequestException
    );
    expect(findAllCredentialsByTypeAndUserId).not.toHaveBeenCalled();
  });

  it("404s for a user that does not exist", async () => {
    findByIdWithProfile.mockResolvedValue(null);

    await expect(service.disconnectUserCalendar(999, "google")).rejects.toThrow(NotFoundException);
  });
});
