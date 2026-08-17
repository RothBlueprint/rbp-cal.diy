import { randomBytes } from "node:crypto";
import { GOOGLE_CALENDAR, OFFICE_365_CALENDAR } from "@calcom/platform-constants";
import { UserCreationService } from "@calcom/platform-libraries";
import type {
  CreateEventTypeInput_2024_06_14,
  GetBookingsInput_2024_08_13,
  UpdateScheduleInput_2024_06_11,
} from "@calcom/platform-types";
import { CreationSource } from "@calcom/prisma/client";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { signState } from "@/lib/oauth-state/signed-state";
import { ConferencingService } from "@/modules/conferencing/services/conferencing.service";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { ProvisionUserInput } from "@/modules/users/inputs/provision-user.input";
import { UsersRepository } from "@/modules/users/users.repository";
import { BookingsService_2024_08_13 } from "@/platform/bookings/2024-08-13/services/bookings.service";
import { CalendarsService } from "@/platform/calendars/services/calendars.service";
import { GoogleCalendarService } from "@/platform/calendars/services/gcal.service";
import { OutlookService } from "@/platform/calendars/services/outlook.service";
import { EventTypesService_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/services/event-types.service";
import { InputEventTypesService_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/services/input-event-types.service";
import { SchedulesService_2024_06_11 } from "@/platform/schedules/schedules_2024_06_11/services/schedules.service";

// Single-use SSO tokens are stored in VerificationToken rows namespaced by this
// identifier prefix (+ the target user id). Short-lived on purpose. The consuming
// web route (/api/auth/rbp-sso) keeps its own copy of this prefix.
const RBP_SSO_TOKEN_IDENTIFIER_PREFIX = "rbp-sso:";
const RBP_SSO_TOKEN_TTL_SECONDS = 60;

@Injectable()
export class UsersAdminService {
  private readonly logger = new Logger("UsersAdminService");

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly schedulesService: SchedulesService_2024_06_11,
    private readonly bookingsService: BookingsService_2024_08_13,
    private readonly conferencingService: ConferencingService,
    private readonly eventTypesService: EventTypesService_2024_06_14,
    private readonly inputEventTypesService: InputEventTypesService_2024_06_14,
    private readonly calendarsService: CalendarsService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly outlookService: OutlookService,
    private readonly dbWrite: PrismaWriteService,
    private readonly configService: ConfigService
  ) {}

  /** Resolve a target user or 404. Every admin-on-behalf-of method starts here. */
  private async requireUser(userId: number) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return user;
  }

  async provisionUser(input: ProvisionUserInput) {
    const existing = await this.usersRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictException(`User with email ${input.email} already exists`);
    }

    const username = input.username ?? input.email.split("@")[0];

    // emailVerified is set up-front: the seeded "email-verification" feature flag otherwise
    // gates first login and hard-blocks Google SSO for unverified accounts, and the
    // provisioning system (rbp) has already verified the address.
    const user = await UserCreationService.createUser({
      data: {
        email: input.email,
        username,
        name: input.name,
        password: input.password,
        timeZone: input.timeZone,
        emailVerified: new Date(),
        creationSource: CreationSource.API_V2,
      },
    });

    // completedOnboarding is not part of CreateUserInput; without it the force-enabled
    // onboarding-v3 wizard runs on first login and creates junk personal event types.
    await this.usersRepository.updateByEmail(input.email, { completedOnboarding: true });

    // UserRepository.create makes a schedule but never sets defaultScheduleId or the
    // schedule timezone; this creates the real default schedule in the user's timezone.
    const schedule = await this.schedulesService.createUserDefaultSchedule(user.id, input.timeZone);

    const teamIds = input.teamIds ?? [];
    for (const teamId of teamIds) {
      await this.membershipsRepository.createMembership(teamId, user.id, "MEMBER", true);
    }

    return {
      id: user.id,
      email: user.email,
      username,
      timeZone: input.timeZone,
      defaultScheduleId: schedule.id,
      teamIds,
    };
  }

  /**
   * The user owning `email`, or 404.
   *
   * Deliberately narrow: this is the recovery path for the 409 `provisionUser`
   * throws, so it returns only what a provisioning caller needs to carry on —
   * chiefly the id every other admin route is keyed on. It is not a user search.
   */
  async getUserByEmail(email: string) {
    if (!email) {
      throw new BadRequestException("email is required");
    }

    const user = await this.usersRepository.findByEmail(email);
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      timeZone: user.timeZone,
    };
  }

  /**
   * Ensure `userId` is an accepted member of `teamId`. Idempotent.
   *
   * Team membership is a prerequisite for being a round-robin host — the event
   * type's host update rejects a user who is not on the team. `provisionUser`
   * covers that for a NEW user via `teamIds`, but there was no way to do it for
   * one that already exists, so an agent adopted through the by-email conflict
   * path (or provisioned before the pool existed) could complete setup and
   * silently never be poolable.
   */
  async addUserToTeam(userId: number, teamId: number) {
    await this.requireUser(userId);

    const team = await this.dbWrite.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    const existing = await this.dbWrite.prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (existing?.accepted) {
      return { id: existing.id, userId, teamId, accepted: true, created: false };
    }

    // upsert, not check-then-create. Two activations can race — a double-submit,
    // or the /calendar auto-complete firing beside an explicit activate — and
    // both would pass the read above, then Membership's @@unique([userId, teamId])
    // would 500 the loser. That is the opposite of the idempotency this endpoint
    // exists to provide, and the caller reports it as "we couldn't set up your
    // calendar just now".
    //
    // `update` also promotes a PENDING membership: unaccepted is not enough to be
    // a host, so treating one as "already there" would reproduce the exact
    // failure this method was added to prevent.
    const membership = await this.dbWrite.prisma.membership.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { teamId, userId, role: "MEMBER", accepted: true, createdAt: new Date() },
      update: { accepted: true },
    });
    // Advisory only — under a race the row may have been created by the other
    // request. Nothing consumes it; it is here to make the logs legible.
    return { id: membership.id, userId, teamId, accepted: true, created: !existing };
  }

  async createLoginToken(userId: number, adminUserId: number) {
    await this.requireUser(userId);

    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + RBP_SSO_TOKEN_TTL_SECONDS * 1000);

    await this.dbWrite.prisma.verificationToken.create({
      data: {
        identifier: `${RBP_SSO_TOKEN_IDENTIFIER_PREFIX}${userId}`,
        token,
        expires,
      },
    });

    // Audit: minting a login token is login-as-anyone power, restricted to admins.
    this.logger.log(`login token minted for user ${userId} by admin ${adminUserId}`);

    const baseUrl = (this.configService.get<string>("app.baseUrl") ?? "").replace(/\/$/, "");
    return {
      token,
      url: `${baseUrl}/api/auth/rbp-sso?token=${token}`,
      expiresInSeconds: RBP_SSO_TOKEN_TTL_SECONDS,
    };
  }

  async getUserBookings(userId: number, queryParams: GetBookingsInput_2024_08_13) {
    const user = await this.requireUser(userId);

    // The shared bookings query scopes to the passed user context (organizer/attendee),
    // so substituting the target user returns that user's bookings.
    return await this.bookingsService.getBookings(queryParams, {
      id: user.id,
      email: user.email,
    });
  }

  // ── Availability ──────────────────────────────────────────────────────────
  //
  // The schedule service is already keyed by userId on every method, so these are
  // pass-throughs whose only job is to substitute the path-param user for the
  // authenticated one. That substitution is the entire point: /v2/schedules is
  // ApiAuthGuard-only and therefore acts as whoever the bearer token IS, which for
  // rbp is the admin — so rbp cannot edit an agent's availability through it.

  async getUserDefaultSchedule(userId: number) {
    await this.requireUser(userId);
    return await this.schedulesService.getUserScheduleDefault(userId);
  }

  async getUserSchedules(userId: number) {
    await this.requireUser(userId);
    return await this.schedulesService.getUserSchedules(userId);
  }

  async updateUserSchedule(userId: number, scheduleId: number, body: UpdateScheduleInput_2024_06_11) {
    await this.requireUser(userId);
    // updateUserSchedule scopes its lookup by userId, so a scheduleId belonging to
    // someone else 404s here rather than being edited across the user boundary.
    return await this.schedulesService.updateUserSchedule(userId, scheduleId, body);
  }

  // ── Event types ───────────────────────────────────────────────────────────
  //
  // POST /v2/event-types acts as whoever the bearer token IS, which for rbp is
  // the admin — using it would attach the event type to the admin account. This
  // substitutes the path-param user, the same shape as schedules and bookings.

  async createUserEventType(userId: number, body: CreateEventTypeInput_2024_06_14) {
    // The profile-joined shape: createUserEventType reads the profile to decide
    // which organisation/profile the event type hangs off.
    const user = await this.usersRepository.findByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    // Transform against the TARGET user, not the caller — the validators check
    // things like schedule ownership, which are the agent's, not the admin's.
    const transformed = await this.inputEventTypesService.transformAndValidateCreateEventTypeInput(
      user,
      body
    );

    return await this.eventTypesService.createUserEventType(user, transformed);
  }

  // ── Conferencing ──────────────────────────────────────────────────────────
  //
  // Including the OAuth start: `getConferencingOAuthUrl` signs a state naming the
  // target user, so the credential lands on THEM even though an admin key began
  // the flow. The user-scoped /v2/conferencing/:app/oauth/auth-url can't do this
  // — it copies the caller's own bearer token into the state and the callback
  // resolves the owner from that, so an admin key would file the agent's Zoom
  // account under the admin. The agent still approves at Zoom/Microsoft, which no
  // design avoids; what they no longer have to do is visit the calendar app.

  async getUserConferencingApps(userId: number) {
    await this.requireUser(userId);
    return await this.conferencingService.getConferencingApps(userId);
  }

  async getUserDefaultConferencingApp(userId: number) {
    await this.requireUser(userId);
    return await this.conferencingService.getUserDefaultConferencingApp(userId);
  }

  async setUserDefaultConferencingApp(userId: number, app: string) {
    // setDefaultConferencingApp reads credentials off the user record, so this one
    // needs the profile-joined shape rather than the bare user.
    const user = await this.usersRepository.findByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return await this.conferencingService.setDefaultConferencingApp(user, app);
  }

  async connectUserNonOauthApp(userId: number, app: string) {
    await this.requireUser(userId);
    // google-meet only — it is the one conferencing app with no OAuth of its own,
    // because it rides the user's existing Google Calendar credential.
    return await this.conferencingService.connectUserNonOauthApp(app, userId);
  }

  /**
   * Start an OAuth conferencing connect on a user's behalf.
   *
   * Returns the provider's consent URL. Redirect the user's browser straight to
   * it — they approve at Zoom/Microsoft and the callback binds the credential to
   * `userId`, then bounces them to `returnTo`. No Cal session, and no Cal page,
   * is involved at any point.
   */
  async getConferencingOAuthUrl(userId: number, app: string, returnTo?: string, onErrorReturnTo?: string) {
    await this.requireUser(userId);
    const state = signState(
      { userId, returnTo, onErrorReturnTo },
      this.configService.get("next.authSecret", { infer: true }) ?? ""
    );
    return await this.conferencingService.generateOAuthUrlWithRawState(app, state);
  }

  // ── Calendars ─────────────────────────────────────────────────────────────
  //
  // Same signed-state mechanism as conferencing, against the Google/Outlook
  // calendar OAuth. Worth stating because it is the step everything else waits
  // on: Google Meet cannot be installed until Google Calendar is connected, and
  // an agent with no connected calendar is bookable over their real commitments.

  /**
   * The user's connected calendars.
   *
   * The settings UI needs this to say whether a calendar is attached at all —
   * without one Cal has no busy times to check, so the round robin books the
   * agent over their real commitments and the first they hear of it is a clash.
   */
  async getUserCalendars(userId: number) {
    await this.requireUser(userId);
    return await this.calendarsService.getCalendars(userId);
  }

  async getCalendarOAuthUrl(userId: number, calendar: string, returnTo?: string) {
    await this.requireUser(userId);
    const state = signState(
      { userId, returnTo },
      this.configService.get("next.authSecret", { infer: true }) ?? ""
    );

    switch (calendar) {
      case GOOGLE_CALENDAR:
        return await this.googleCalendarService.getCalendarRedirectUrl(
          "",
          returnTo ?? "",
          returnTo,
          false,
          state
        );
      case OFFICE_365_CALENDAR:
        return await this.outlookService.getCalendarRedirectUrl("", returnTo ?? "", returnTo, false, state);
      default:
        throw new BadRequestException(
          `Invalid calendar. Available: ${[GOOGLE_CALENDAR, OFFICE_365_CALENDAR].join(", ")}`
        );
    }
  }

  async disconnectUserConferencingApp(userId: number, app: string) {
    const user = await this.usersRepository.findByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return await this.conferencingService.disconnectConferencingApp(user, app);
  }
}
