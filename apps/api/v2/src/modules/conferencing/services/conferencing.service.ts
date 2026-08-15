import {
  CAL_VIDEO,
  CONFERENCING_APPS,
  GOOGLE_MEET,
  OFFICE_365_VIDEO,
  ZOOM,
} from "@calcom/platform-constants";
import { userMetadata } from "@calcom/platform-libraries";
import {
  getApps,
  getUsersCredentialsIncludeServiceAccountKey,
  handleDeleteCredential,
} from "@calcom/platform-libraries/app-store";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { OAuthCallbackState } from "@/modules/conferencing/controllers/conferencing.controller";
import { ConferencingRepository } from "@/modules/conferencing/repositories/conferencing.repository";
import { GoogleMeetService } from "@/modules/conferencing/services/google-meet.service";
import { Office365VideoService } from "@/modules/conferencing/services/office365-video.service";
import { ZoomVideoService } from "@/modules/conferencing/services/zoom-video.service";
import { TokensRepository } from "@/modules/tokens/tokens.repository";
import { UsersRepository, UserWithProfile } from "@/modules/users/users.repository";

@Injectable()
export class ConferencingService {
  private logger = new Logger("ConferencingService");

  constructor(
    private readonly conferencingRepository: ConferencingRepository,
    private readonly usersRepository: UsersRepository,
    private readonly tokensRepository: TokensRepository,
    private readonly googleMeetService: GoogleMeetService,
    private readonly zoomVideoService: ZoomVideoService,
    private readonly office365VideoService: Office365VideoService
  ) {}

  async getConferencingApps(userId: number) {
    return this.conferencingRepository.findConferencingApps(userId);
  }

  async connectUserNonOauthApp(app: string, userId: number) {
    switch (app) {
      case GOOGLE_MEET: {
        const credential = await this.googleMeetService.connectGoogleMeetToUser(userId);
        return credential;
      }
      default:
        throw new BadRequestException("Invalid conferencing app. Available apps: GOOGLE_MEET.");
    }
  }

  async connectOauthApps(
    app: string,
    code: string,
    decodedCallbackState: OAuthCallbackState,
    teamId?: number,
    /**
     * Owner resolved from a VERIFIED signed state, when the flow was started by
     * an admin on this user's behalf. Already authenticated by the time it gets
     * here — the controller rejects a signed state that fails verification
     * rather than passing it on — so it is trusted exactly as much as the
     * accessToken lookup below.
     */
    signedStateUserId?: number
  ) {
    const userId =
      signedStateUserId ??
      (await this.tokensRepository.getAccessTokenOwnerId(decodedCallbackState.accessToken));
    if (!userId) {
      throw new UnauthorizedException("Invalid Access token.");
    }
    switch (app) {
      case ZOOM:
        return await this.zoomVideoService.connectZoomApp(decodedCallbackState, code, userId, teamId);

      case OFFICE_365_VIDEO:
        return await this.office365VideoService.connectOffice365App(
          decodedCallbackState,
          code,
          userId,
          teamId
        );

      default:
        throw new BadRequestException(
          "Invalid conferencing app, available apps are: ",
          [ZOOM, OFFICE_365_VIDEO].join(", ")
        );
    }
  }

  async getUserDefaultConferencingApp(userId: number) {
    const user = await this.usersRepository.findById(userId);
    return userMetadata.parse(user?.metadata)?.defaultConferencingApp;
  }

  async checkAppIsValidAndConnected(user: UserWithProfile, appSlug: string) {
    if (!CONFERENCING_APPS.includes(appSlug)) {
      throw new BadRequestException("Invalid app, available apps are: ", CONFERENCING_APPS.join(", "));
    }
    const credentials = await getUsersCredentialsIncludeServiceAccountKey(user);

    const foundApp = getApps(credentials, true).filter((app) => app.slug === appSlug)[0];

    const appLocation = foundApp?.appData?.location;

    if (!foundApp || !appLocation) {
      throw new BadRequestException(`${appSlug} not connected.`);
    }
    return foundApp.credential;
  }

  async disconnectConferencingApp(user: UserWithProfile, app: string) {
    const credential = await this.checkAppIsValidAndConnected(user, app);
    return handleDeleteCredential({
      userId: user.id,
      userMetadata: user?.metadata,
      credentialId: credential.id,
    });
  }

  async setDefaultConferencingApp(user: UserWithProfile, app: string) {
    // cal-video is global, so we can skip this check
    if (app !== CAL_VIDEO) {
      await this.checkAppIsValidAndConnected(user, app);
    }
    const updatedUser = await this.usersRepository.setDefaultConferencingApp(user.id, app);
    const metadata = updatedUser.metadata as { defaultConferencingApp?: { appSlug?: string } };
    if (metadata?.defaultConferencingApp?.appSlug !== app) {
      throw new InternalServerErrorException(`Could not set ${app} as default conferencing app`);
    }
    return true;
  }

  async generateOAuthUrl(app: string, state: OAuthCallbackState) {
    return await this.generateOAuthUrlWithRawState(app, JSON.stringify(state));
  }

  /**
   * Same as {@link generateOAuthUrl} but takes the `state` already serialized.
   *
   * Exists for the signed-state flow: a signed state is an opaque
   * `v1.<payload>.<sig>` string whose bytes must reach the callback UNCHANGED,
   * and running it back through JSON.stringify would wrap it in quotes and
   * invalidate every signature.
   */
  async generateOAuthUrlWithRawState(app: string, rawState: string) {
    switch (app) {
      case ZOOM:
        return await this.zoomVideoService.generateZoomAuthUrl(rawState);

      case OFFICE_365_VIDEO:
        return await this.office365VideoService.generateOffice365AuthUrl(rawState);

      default:
        throw new BadRequestException(
          "Invalid conferencing app, available apps are: ",
          [ZOOM, OFFICE_365_VIDEO].join(", ")
        );
    }
  }
}
