/**
 * rbp: covers the ordering guarantees of the disconnect handler — revoke the Google OAuth
 * grant first, delete the credential row second, and never revoke for other providers.
 *
 * Virtual mocks for the @calcom/platform-libraries workspace packages follow the pattern in
 * cal-unified-calendars/services/google-calendar.service.spec.ts: their transitive deps
 * (prisma, DB connections) cannot be resolved in the Jest unit environment.
 */
jest.mock("@calcom/platform-libraries/app-store", () => ({}), {
  virtual: true,
});
jest.mock("@calcom/platform-libraries", () => ({}), { virtual: true });
jest.mock("@calcom/platform-libraries/repositories", () => ({}), {
  virtual: true,
});
jest.mock("googleapis-common", () => ({ OAuth2Client: jest.fn() }));
jest.mock("@googleapis/calendar", () => ({
  calendar_v3: { Calendar: jest.fn() },
}));

import {
  APPLE_CALENDAR_TYPE,
  GOOGLE_CALENDAR_TYPE,
  OFFICE_365_CALENDAR_TYPE,
} from "@calcom/platform-constants";
import { ServiceUnavailableException } from "@nestjs/common";
import { CalendarsController } from "@/platform/calendars/controllers/calendars.controller";

describe("CalendarsController disconnect — Google grant revoke", () => {
  const user = { id: 7 } as never;
  const googleCredential = {
    id: 11,
    type: GOOGLE_CALENDAR_TYPE,
    key: { access_token: "at", refresh_token: "rt" },
    userId: 7,
    teamId: null,
    appId: "google-calendar",
    invalid: false,
  };

  let calls: string[];
  let checkCalendarCredentials: jest.Mock;
  let revokeGrant: jest.Mock;
  let deleteCredentials: jest.Mock;
  let controller: CalendarsController;

  const buildController = (credential: Record<string, unknown>) => {
    calls = [];
    checkCalendarCredentials = jest.fn().mockResolvedValue(credential);
    revokeGrant = jest.fn().mockImplementation(async () => {
      calls.push("revoke");
    });
    deleteCredentials = jest.fn().mockImplementation(async () => {
      calls.push("delete");
      return credential;
    });

    return new CalendarsController(
      { checkCalendarCredentials } as never,
      { deleteConnectedAndDestinationCalendarsCache: jest.fn() } as never,
      {} as never,
      { revokeGrant } as never,
      {} as never,
      {} as never,
      { deleteCredentials } as never,
      { get: jest.fn() } as never
    );
  };

  it("revokes the grant before deleting the credential row", async () => {
    controller = buildController(googleCredential);

    await controller.deleteCalendarCredentials("google", { id: 11 }, user);

    // Order is the whole point: the refresh token lives on the row, so a delete-first
    // ordering would strand a live grant that nothing could revoke afterwards.
    expect(calls).toEqual(["revoke", "delete"]);
    expect(revokeGrant).toHaveBeenCalledWith(googleCredential.key);
  });

  it("aborts before deleting when the revoke genuinely fails", async () => {
    controller = buildController(googleCredential);
    revokeGrant.mockRejectedValue(new ServiceUnavailableException("nope"));

    await expect(controller.deleteCalendarCredentials("google", { id: 11 }, user)).rejects.toThrow(
      ServiceUnavailableException
    );

    // The row survives, so the settings page still offers Disconnect and the user can retry.
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ["Outlook", OFFICE_365_CALENDAR_TYPE],
    ["Apple", APPLE_CALENDAR_TYPE],
  ])("never revokes for %s and still deletes the credential", async (_name, type) => {
    controller = buildController({ ...googleCredential, type });

    await controller.deleteCalendarCredentials("office365", { id: 11 }, user);

    expect(revokeGrant).not.toHaveBeenCalled();
    expect(deleteCredentials).toHaveBeenCalledWith(11);
  });
});
