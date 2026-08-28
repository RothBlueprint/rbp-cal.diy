import { GOOGLE_CALENDAR_TYPE, SUCCESS_STATUS } from "@calcom/platform-constants";
import { OAuth2UniversalSchema } from "@calcom/platform-libraries/app-store";
import { Prisma } from "@calcom/prisma/client";
import { calendar_v3 } from "@googleapis/calendar";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { OAuth2Client } from "googleapis-common";
import { z } from "zod";
import { AppsRepository } from "@/modules/apps/apps.repository";
import { CredentialsRepository } from "@/modules/credentials/credentials.repository";
import { SelectedCalendarsRepository } from "@/modules/selected-calendars/selected-calendars.repository";
import { TokensService } from "@/modules/tokens/tokens.service";
import { OAuthCalendarApp } from "@/platform/calendars/calendars.interface";
import type { CalendarState } from "@/platform/calendars/controllers/calendars.controller";
import { CalendarsService } from "@/platform/calendars/services/calendars.service";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// rbp: shape of a failed Google API call, narrowed structurally so we do not depend on
// gaxios' own error types. A transport error or a timeout carries no `response` at all,
// which is precisely the signal that we never reached Google.
const googleApiErrorSchema = z.object({
  response: z.object({
    status: z.number(),
    data: z.union([z.object({ error: z.string().optional() }).passthrough(), z.string()]).optional(),
  }),
});

/**
 * rbp: Google answers 400 `invalid_token` when the token is already dead — the normal case
 * when the user revoked at myaccount.google.com/permissions before disconnecting here. The
 * grant is gone, which is the outcome we wanted, so the caller may delete the credential.
 *
 * Anything else (no response, a 5xx, another 4xx) means we do not know whether the grant
 * survived. Those must not be swallowed: reporting a completed disconnect over a grant that
 * is still live in the user's Google account is the exact failure this code exists to remove.
 */
function isGoogleTokenAlreadyInvalid(error: unknown): boolean {
  const parsed = googleApiErrorSchema.safeParse(error);
  if (!parsed.success || parsed.data.response.status !== 400) {
    return false;
  }
  const { data } = parsed.data.response;
  // The body is usually parsed JSON, but can arrive as a raw string.
  const code = typeof data === "string" ? data : data?.error ?? "";
  return code.includes("invalid_token") || code.includes("invalid_grant");
}

@Injectable()
export class GoogleCalendarService implements OAuthCalendarApp {
  public readonly redirectUri = `${this.config.get("api.url")}/gcal/oauth/save`;
  private gcalResponseSchema = z.object({ client_id: z.string(), client_secret: z.string() });
  private logger = new Logger("GcalService");

  constructor(
    private readonly config: ConfigService,
    private readonly appsRepository: AppsRepository,
    private readonly credentialRepository: CredentialsRepository,
    private readonly calendarsService: CalendarsService,
    private readonly tokensService: TokensService,
    private readonly selectedCalendarsRepository: SelectedCalendarsRepository
  ) {}

  async connect(
    authorization: string,
    req: Request,
    redir?: string,
    isDryRun?: boolean
  ): Promise<{ status: typeof SUCCESS_STATUS; data: { authUrl: string } }> {
    const accessToken = authorization.replace("Bearer ", "");
    const origin = req.get("origin") ?? req.get("host");
    const redirectUrl = await this.getCalendarRedirectUrl(accessToken, origin ?? "", redir, isDryRun);

    return { status: SUCCESS_STATUS, data: { authUrl: redirectUrl } };
  }

  async save(
    code: string,
    accessToken: string,
    origin: string,
    redir?: string,
    isDryRun?: boolean,
    signedStateUserId?: number
  ): Promise<{ url: string }> {
    return await this.saveCalendarCredentialsAndRedirect(
      code,
      accessToken,
      origin,
      redir,
      isDryRun,
      signedStateUserId
    );
  }

  async check(userId: number): Promise<{ status: typeof SUCCESS_STATUS }> {
    return await this.checkIfCalendarConnected(userId);
  }

  /**
   * `rawState` overrides the JSON state entirely, for the admin-driven signed-state
   * flow (lib/oauth-state/signed-state.ts). It must reach the provider byte-for-byte
   * — re-serializing a signed state invalidates its signature.
   */
  async getCalendarRedirectUrl(
    accessToken: string,
    origin: string,
    redir?: string,
    isDryRun?: boolean,
    rawState?: string
  ) {
    const oAuth2Client = await this.getOAuthClient(this.redirectUri);
    const state: CalendarState = {
      accessToken,
      origin,
      redir,
      isDryRun,
    };

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: CALENDAR_SCOPES,
      prompt: "consent",
      state: rawState ?? JSON.stringify(state),
    });

    return authUrl;
  }

  async getOAuthClient(redirectUri: string) {
    this.logger.log("Getting Google Calendar OAuth Client");
    const app = await this.appsRepository.getAppBySlug("google-calendar");

    if (!app) {
      throw new NotFoundException();
    }

    const { client_id, client_secret } = this.gcalResponseSchema.parse(app.keys);

    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirectUri);
    return oAuth2Client;
  }

  /**
   * rbp: Google OAuth verification requires that disconnecting the calendar in our app also
   * drops the grant at myaccount.google.com/permissions. Nothing else in this fork tells
   * Google to do that — disconnect only deleted our own credential row.
   *
   * Revokes the *refresh* token, which invalidates the whole grant; revoking only the access
   * token leaves the grant listed in the user's Google account.
   *
   * Throws when the revoke genuinely failed, so the caller aborts before deleting the
   * credential row: the refresh token lives on that row, so deleting first would strand a
   * live grant with nothing left anywhere able to revoke it.
   */
  async revokeGrant(credentialKey: unknown): Promise<void> {
    const parsedKey = OAuth2UniversalSchema.safeParse(credentialKey);
    const token = parsedKey.success ? parsedKey.data.refresh_token ?? parsedKey.data.access_token : undefined;

    if (!token) {
      // No revocable token was ever stored, so there is no grant we could drop. Refusing here
      // would make the credential impossible to delete, permanently.
      this.logger.warn("No Google OAuth token stored on credential, nothing to revoke");
      return;
    }

    const oAuth2Client = await this.getOAuthClient(this.redirectUri);

    try {
      await oAuth2Client.revokeToken(token);
    } catch (error) {
      if (isGoogleTokenAlreadyInvalid(error)) {
        this.logger.log("Google OAuth token was already invalid, treating the grant as revoked");
        return;
      }
      this.logger.error("Failed to revoke Google OAuth grant", error);
      throw new ServiceUnavailableException(
        "Could not revoke the Google Calendar access grant, so the calendar was left connected. Please try disconnecting again."
      );
    }
  }

  async checkIfCalendarConnected(userId: number): Promise<{ status: typeof SUCCESS_STATUS }> {
    const gcalCredentials = await this.credentialRepository.findCredentialByTypeAndUserId(
      "google_calendar",
      userId
    );

    if (!gcalCredentials) {
      throw new BadRequestException("Credentials for google_calendar not found.");
    }

    if (gcalCredentials.invalid) {
      throw new BadRequestException("Invalid google OAuth credentials.");
    }

    const { connectedCalendars } = await this.calendarsService.getCalendars(userId);
    const googleCalendar = connectedCalendars.find(
      (cal: { integration: { type: string } }) => cal.integration.type === GOOGLE_CALENDAR_TYPE
    );
    if (!googleCalendar) {
      throw new UnauthorizedException("Google Calendar not connected.");
    }
    if (googleCalendar.error?.message) {
      throw new UnauthorizedException(googleCalendar.error?.message);
    }

    return { status: SUCCESS_STATUS };
  }

  async saveCalendarCredentialsAndRedirect(
    code: string,
    accessToken: string,
    origin: string,
    redir?: string,
    isDryRun?: boolean,
    /**
     * Owner taken from a VERIFIED signed state, when an admin started this flow
     * on the user's behalf. The controller refuses a signed state that fails
     * verification, so reaching here means it is as trustworthy as the bearer
     * secret the accessToken branch relies on.
     */
    signedStateUserId?: number
  ) {
    // User chose not to authorize your app or didn't authorize your app
    // redirect directly without oauth code
    if (!code || code === "undefined") {
      return { url: redir || origin };
    }

    // if isDryRun is true we know its a dry run so we just redirect straight away
    if (isDryRun) {
      return { url: redir || origin };
    }

    const parsedCode = z.string().parse(code);

    const ownerId = signedStateUserId ?? (await this.tokensService.getAccessTokenOwnerId(accessToken));

    if (!ownerId) {
      throw new UnauthorizedException("Invalid Access token.");
    }

    const oAuth2Client = await this.getOAuthClient(this.redirectUri);
    const token = await oAuth2Client.getToken(parsedCode);
    // Google oAuth Credentials are stored in token.tokens
    const key = token.tokens;

    oAuth2Client.setCredentials(key);

    const calendar = new calendar_v3.Calendar({
      auth: oAuth2Client,
    });

    const cals = await calendar.calendarList.list({ fields: "items(id,summary,primary,accessRole)" });

    const primaryCal = cals.data.items?.find((cal) => cal.primary);

    if (primaryCal?.id) {
      const alreadyExistingSelectedCalendar = await this.selectedCalendarsRepository.getUserSelectedCalendar(
        ownerId,
        GOOGLE_CALENDAR_TYPE,
        primaryCal.id
      );

      if (alreadyExistingSelectedCalendar) {
        // rbp: always persist the key we just minted. This used to be gated on
        // checkCalendarCredentialValidity, which only reads the stored `invalid` flag and
        // never asks Google. A grant revoked at Google leaves invalid=false — Cal only sets
        // it once something trips over the failure — so the gate reported "still valid", the
        // fresh token was thrown away, and the calendar stayed stuck on "needs reconnecting"
        // with no way out through the UI. The consent just completed, so the token in hand is
        // authoritative regardless of what that flag claims. The upsert also clears `invalid`.
        await this.calendarsService.createAndLinkCalendarEntry(
          ownerId,
          alreadyExistingSelectedCalendar.externalId,
          key as Prisma.InputJsonValue,
          GOOGLE_CALENDAR_TYPE,
          alreadyExistingSelectedCalendar.credentialId
        );

        return {
          url: redir || origin,
        };
      }

      await this.calendarsService.createAndLinkCalendarEntry(
        ownerId,
        primaryCal.id,
        key as Prisma.InputJsonValue,
        GOOGLE_CALENDAR_TYPE
      );
    }

    return { url: redir || origin };
  }
}
