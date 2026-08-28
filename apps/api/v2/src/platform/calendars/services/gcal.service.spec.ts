/**
 * rbp: covers the OAuth-grant revoke that runs on calendar disconnect.
 *
 * Virtual mocks follow the pattern in cal-unified-calendars/services/google-calendar.service.spec.ts:
 * the @calcom/platform-libraries workspace packages pull in prisma/DB connections that cannot be
 * resolved in the Jest unit environment. OAuth2UniversalSchema is rebuilt from real zod here because
 * the code under test depends on its parsing behaviour, not just its presence.
 */
const mockRevokeToken = jest.fn();
const mockGetToken = jest.fn();
const mockCalendarListList = jest.fn();
const MockOAuth2Client = jest.fn().mockImplementation(() => ({
  revokeToken: mockRevokeToken,
  getToken: mockGetToken,
  setCredentials: jest.fn(),
}));

jest.mock(
  "@calcom/platform-libraries/app-store",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { z } = require("zod");
    return {
      OAuth2UniversalSchema: z
        .object({
          access_token: z.string(),
          refresh_token: z.string().optional(),
        })
        .passthrough(),
    };
  },
  { virtual: true }
);
jest.mock("@calcom/platform-libraries", () => ({}), { virtual: true });
jest.mock("googleapis-common", () => ({ OAuth2Client: MockOAuth2Client }));
jest.mock("@googleapis/calendar", () => ({
  calendar_v3: {
    Calendar: jest.fn().mockImplementation(() => ({
      calendarList: { list: mockCalendarListList },
    })),
  },
}));

import { ServiceUnavailableException } from "@nestjs/common";
import { GoogleCalendarService } from "@/platform/calendars/services/gcal.service";

/** A gaxios failure: `response` present means we reached Google and it answered. */
const googleAnswered = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status ${status}`), {
    response: { status, data },
  });

/** A transport error or timeout never reaches Google, so it carries no `response`. */
const neverReachedGoogle = () => Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });

describe("GoogleCalendarService.revokeGrant", () => {
  let service: GoogleCalendarService;

  const buildService = () =>
    new GoogleCalendarService(
      { get: jest.fn().mockReturnValue("https://api.example.com") } as never,
      {
        getAppBySlug: jest.fn().mockResolvedValue({
          keys: { client_id: "cid", client_secret: "csecret" },
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  it("revokes the refresh token, not the access token", async () => {
    mockRevokeToken.mockResolvedValue({ status: 200 });

    await service.revokeGrant({ access_token: "at", refresh_token: "rt" });

    // Revoking the refresh token drops the whole grant; the access token alone would leave
    // the app listed at myaccount.google.com/permissions.
    expect(mockRevokeToken).toHaveBeenCalledTimes(1);
    expect(mockRevokeToken).toHaveBeenCalledWith("rt");
  });

  it("treats a 400 invalid_token as already revoked so the credential can still be deleted", async () => {
    mockRevokeToken.mockRejectedValue(googleAnswered(400, { error: "invalid_token" }));

    // Resolving is what lets the caller proceed to delete the row. The advisor who revoked at
    // myaccount.google.com first must still be able to remove the calendar here.
    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).resolves.toBeUndefined();
  });

  it("treats a 400 invalid_grant as already revoked", async () => {
    mockRevokeToken.mockRejectedValue(googleAnswered(400, { error: "invalid_grant" }));

    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).resolves.toBeUndefined();
  });

  it("treats a raw-string 400 body naming invalid_token as already revoked", async () => {
    mockRevokeToken.mockRejectedValue(googleAnswered(400, '{"error":"invalid_token"}'));

    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).resolves.toBeUndefined();
  });

  it("throws on a transport error so the caller aborts before deleting", async () => {
    mockRevokeToken.mockRejectedValue(neverReachedGoogle());

    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("throws on a 5xx so the caller aborts before deleting", async () => {
    mockRevokeToken.mockRejectedValue(googleAnswered(503, { error: "backend_error" }));

    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("throws on a 400 that does not mean the token is dead", async () => {
    mockRevokeToken.mockRejectedValue(googleAnswered(400, { error: "invalid_client" }));

    await expect(service.revokeGrant({ access_token: "at", refresh_token: "rt" })).rejects.toThrow(
      ServiceUnavailableException
    );
  });

  it("falls back to the access token when no refresh token was stored", async () => {
    mockRevokeToken.mockResolvedValue({ status: 200 });

    await service.revokeGrant({ access_token: "at" });

    expect(mockRevokeToken).toHaveBeenCalledWith("at");
  });

  it("skips the revoke when the key holds no usable token, so the row stays deletable", async () => {
    await service.revokeGrant({ nothing: "useful" });

    expect(mockRevokeToken).not.toHaveBeenCalled();
  });
});

/**
 * rbp: bug 2 — reconnect used to be a no-op for exactly the state it exists to fix.
 * A grant revoked at Google leaves the stored `invalid` flag false, so the old validity gate
 * reported "still valid", skipped the write, and threw the freshly minted token away.
 */
describe("GoogleCalendarService.saveCalendarCredentialsAndRedirect — reconnect persists the new key", () => {
  const ownerId = 6;
  const freshKey = { access_token: "new-at", refresh_token: "new-rt" };

  let createAndLinkCalendarEntry: jest.Mock;
  let checkCalendarCredentialValidity: jest.Mock;
  let getUserSelectedCalendar: jest.Mock;
  let service: GoogleCalendarService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetToken.mockResolvedValue({ tokens: freshKey });
    mockCalendarListList.mockResolvedValue({
      data: { items: [{ id: "primary@gmail.com", primary: true }] },
    });

    createAndLinkCalendarEntry = jest.fn().mockResolvedValue(undefined);
    // The stale flag says "valid" — the production state of credential 11, where the advisor
    // had already revoked at Google but Cal had never noticed.
    checkCalendarCredentialValidity = jest.fn().mockResolvedValue(true);
    getUserSelectedCalendar = jest.fn().mockResolvedValue({
      externalId: "primary@gmail.com",
      credentialId: 11,
    });

    service = new GoogleCalendarService(
      { get: jest.fn().mockReturnValue("https://api.example.com") } as never,
      {
        getAppBySlug: jest.fn().mockResolvedValue({ keys: { client_id: "cid", client_secret: "csecret" } }),
      } as never,
      {} as never,
      { createAndLinkCalendarEntry, checkCalendarCredentialValidity } as never,
      { getAccessTokenOwnerId: jest.fn().mockResolvedValue(ownerId) } as never,
      { getUserSelectedCalendar } as never
    );
  });

  it("persists the new key even when the stored credential still looks valid", async () => {
    await service.saveCalendarCredentialsAndRedirect("auth-code", "token", "https://app.example.com");

    expect(createAndLinkCalendarEntry).toHaveBeenCalledTimes(1);
    expect(createAndLinkCalendarEntry).toHaveBeenCalledWith(
      ownerId,
      "primary@gmail.com",
      freshKey,
      "google_calendar",
      11
    );
  });

  it("does not gate persistence on the stale invalid flag", async () => {
    await service.saveCalendarCredentialsAndRedirect("auth-code", "token", "https://app.example.com");

    // The gate is gone entirely; consulting it at all is what produced the deadlock.
    expect(checkCalendarCredentialValidity).not.toHaveBeenCalled();
  });

  it("still links a first-time connection when no SelectedCalendar exists yet", async () => {
    getUserSelectedCalendar.mockResolvedValue(null);

    await service.saveCalendarCredentialsAndRedirect("auth-code", "token", "https://app.example.com");

    expect(createAndLinkCalendarEntry).toHaveBeenCalledWith(
      ownerId,
      "primary@gmail.com",
      freshKey,
      "google_calendar"
    );
  });
});
