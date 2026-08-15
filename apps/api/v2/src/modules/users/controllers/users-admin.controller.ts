import {
  GOOGLE_CALENDAR,
  GOOGLE_MEET,
  OFFICE_365_CALENDAR,
  OFFICE_365_VIDEO,
  SUCCESS_STATUS,
  ZOOM,
} from "@calcom/platform-constants";
import type {
  CreateEventTypeInput_2024_06_14,
  GetBookingsInput_2024_08_13,
  GetBookingsOutput_2024_08_13,
  UpdateScheduleInput_2024_06_11,
} from "@calcom/platform-types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags as DocsTags } from "@nestjs/swagger";
import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { API_KEY_HEADER } from "@/lib/docs/headers";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { IsSystemAdminGuard } from "@/modules/auth/guards/system-admin/is-system-admin.guard";
import { ProvisionUserInput } from "@/modules/users/inputs/provision-user.input";
import { LoginTokenOutput } from "@/modules/users/outputs/login-token.output";
import { ProvisionUserOutput } from "@/modules/users/outputs/provision-user.output";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";

type AdminStatusResponse = { status: typeof SUCCESS_STATUS };
type AdminDataResponse = AdminStatusResponse & { data: unknown };

@Controller({
  path: "/v2/users",
  version: API_VERSIONS_VALUES,
})
@UseGuards(ApiAuthGuard, IsSystemAdminGuard)
@DocsTags("Users / Admin")
@ApiHeader(API_KEY_HEADER)
export class UsersAdminController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  @Post("/")
  @ApiOperation({ summary: "Provision a user (admin only)" })
  async provisionUser(@Body() body: ProvisionUserInput): Promise<ProvisionUserOutput> {
    const data = await this.usersAdminService.provisionUser(body);

    return {
      status: SUCCESS_STATUS,
      data,
    };
  }

  @Post("/:userId/login-token")
  @ApiOperation({
    summary: "Mint a single-use SSO login token for a user (admin only)",
    description:
      "Returns a short-lived token and url. Redirect the user's browser to that url to sign them in transparently (append &next=/path to control the landing page). Powerful — logs the caller in as the target user; admin-key gated and single-use.",
  })
  async createLoginToken(
    @Param("userId", ParseIntPipe) userId: number,
    @GetUser("id") adminUserId: number
  ): Promise<LoginTokenOutput> {
    const data = await this.usersAdminService.createLoginToken(userId, adminUserId);

    return {
      status: SUCCESS_STATUS,
      data,
    };
  }

  @Get("/:userId/bookings")
  @ApiOperation({ summary: "Get a user's bookings (admin only)" })
  async getUserBookings(
    @Param("userId", ParseIntPipe) userId: number,
    @Query() queryParams: GetBookingsInput_2024_08_13
  ): Promise<GetBookingsOutput_2024_08_13> {
    const { bookings, pagination } = await this.usersAdminService.getUserBookings(userId, queryParams);

    return {
      status: SUCCESS_STATUS,
      data: bookings,
      pagination,
    };
  }

  // ── Availability (admin-on-behalf-of) ─────────────────────────────────────
  //
  // Mirrors /v2/schedules, but keyed by a path-param userId under the admin guard
  // instead of by the bearer's own identity. This is what lets an agent's working
  // hours be edited from a form on rothblueprint.com without the agent ever
  // holding a Cal credential.

  @Get("/:userId/schedules")
  @ApiOperation({ summary: "Get a user's schedules (admin only)" })
  async getUserSchedules(@Param("userId", ParseIntPipe) userId: number): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getUserSchedules(userId);

    return { status: SUCCESS_STATUS, data };
  }

  @Get("/:userId/schedules/default")
  @ApiOperation({ summary: "Get a user's default schedule (admin only)" })
  async getUserDefaultSchedule(@Param("userId", ParseIntPipe) userId: number): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getUserDefaultSchedule(userId);

    return { status: SUCCESS_STATUS, data };
  }

  @Patch("/:userId/schedules/:scheduleId")
  @ApiOperation({ summary: "Update a user's schedule (admin only)" })
  async updateUserSchedule(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("scheduleId", ParseIntPipe) scheduleId: number,
    @Body() body: UpdateScheduleInput_2024_06_11
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.updateUserSchedule(userId, scheduleId, body);

    return { status: SUCCESS_STATUS, data };
  }

  // ── Event types (admin-on-behalf-of) ──────────────────────────────────────
  //
  // Mirrors POST /v2/event-types, keyed by a path-param userId. The public
  // endpoint creates for whoever the bearer token IS — for rbp that is the
  // admin — so an agent's personal booking page has to be created through here.

  @Post("/:userId/event-types")
  @ApiOperation({ summary: "Create a personal event type for a user (admin only)" })
  async createUserEventType(
    @Param("userId", ParseIntPipe) userId: number,
    @Body() body: CreateEventTypeInput_2024_06_14
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.createUserEventType(userId, body);

    return { status: SUCCESS_STATUS, data };
  }

  // ── Conferencing (admin-on-behalf-of) ─────────────────────────────────────
  //
  // Read, choose the default, start an OAuth connect, and disconnect. The OAuth
  // start works by signing the target user into the `state` (see
  // lib/oauth-state/signed-state.ts) rather than copying a bearer token into it,
  // which is what lets an admin key begin a flow whose credential lands on the
  // user. The user still approves at the provider — that part is OAuth itself,
  // not something the API could route around.

  @Get("/:userId/conferencing")
  @ApiOperation({
    summary: "Get a user's connected conferencing apps (admin only)",
    description:
      'Returns the raw credential rows (id, type, appId, invalid, …), NOT the narrowed ConferencingAppsOutputDto the user-scoped GET /v2/conferencing serialises through. That DTO exposes only id/type/userId and so drops `appId` — which is the app SLUG ("zoom", "google-meet", "msteams") and the only field that says which app a row is. `type` is the credential type ("zoom_video", "google_video", "office365_video"), a different string. Consumers should key off appId.',
  })
  async getUserConferencingApps(@Param("userId", ParseIntPipe) userId: number): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getUserConferencingApps(userId);

    return { status: SUCCESS_STATUS, data };
  }

  @Get("/:userId/conferencing/default")
  @ApiOperation({ summary: "Get a user's default conferencing app (admin only)" })
  async getUserDefaultConferencingApp(
    @Param("userId", ParseIntPipe) userId: number
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getUserDefaultConferencingApp(userId);

    return { status: SUCCESS_STATUS, data };
  }

  @Get("/:userId/conferencing/:app/oauth/auth-url")
  @ApiOperation({
    summary: "Start an OAuth conferencing connect for a user (admin only)",
    description:
      "Returns the provider consent URL for zoom or msteams. Redirect the user's browser straight to it: they approve at the provider, and the callback binds the credential to this user because the `state` is signed with their id. Unlike the user-scoped GET /v2/conferencing/{app}/oauth/auth-url, this needs no session or access token for the target user.",
  })
  @ApiParam({ name: "app", enum: [ZOOM, OFFICE_365_VIDEO], required: true })
  async getUserConferencingOAuthUrl(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("app") app: string,
    @Query("returnTo") returnTo?: string,
    @Query("onErrorReturnTo") onErrorReturnTo?: string
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getConferencingOAuthUrl(userId, app, returnTo, onErrorReturnTo);

    return { status: SUCCESS_STATUS, data };
  }

  @Post("/:userId/conferencing/:app/connect")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Connect a user's non-OAuth conferencing app (admin only)",
    description:
      "Only google-meet, which has no OAuth of its own — it requires (and reuses) the user's existing Google Calendar connection. Zoom and Office 365 must be connected in the user's own session.",
  })
  @ApiParam({ name: "app", enum: [GOOGLE_MEET], required: true })
  async connectUserNonOauthApp(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("app") app: string
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.connectUserNonOauthApp(userId, app);

    return { status: SUCCESS_STATUS, data };
  }

  @Post("/:userId/conferencing/:app/default")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Set a user's default conferencing app (admin only)" })
  async setUserDefaultConferencingApp(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("app") app: string
  ): Promise<AdminStatusResponse> {
    await this.usersAdminService.setUserDefaultConferencingApp(userId, app);

    return { status: SUCCESS_STATUS };
  }

  @Get("/:userId/calendars")
  @ApiOperation({ summary: "Get a user's connected calendars (admin only)" })
  async getUserCalendars(@Param("userId", ParseIntPipe) userId: number): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getUserCalendars(userId);

    return { status: SUCCESS_STATUS, data };
  }

  @Get("/:userId/calendars/:calendar/connect")
  @ApiOperation({
    summary: "Start a calendar OAuth connect for a user (admin only)",
    description:
      "Returns the provider consent URL for google or office365. Redirect the user's browser straight to it; the callback binds the calendar to this user via the signed `state`. Unlike the user-scoped GET /v2/calendars/{calendar}/connect — which is restricted to API_KEY/ACCESS_TOKEN auth and therefore always connects the CALLER's calendar — this connects the named user's.",
  })
  @ApiParam({ name: "calendar", enum: [GOOGLE_CALENDAR, OFFICE_365_CALENDAR], required: true })
  async getUserCalendarOAuthUrl(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("calendar") calendar: string,
    @Query("returnTo") returnTo?: string
  ): Promise<AdminDataResponse> {
    const data = await this.usersAdminService.getCalendarOAuthUrl(userId, calendar, returnTo);

    return { status: SUCCESS_STATUS, data: { authUrl: data } };
  }

  @Delete("/:userId/conferencing/:app/disconnect")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disconnect a user's conferencing app (admin only)" })
  async disconnectUserConferencingApp(
    @Param("userId", ParseIntPipe) userId: number,
    @Param("app") app: string
  ): Promise<AdminStatusResponse> {
    await this.usersAdminService.disconnectUserConferencingApp(userId, app);

    return { status: SUCCESS_STATUS };
  }
}
