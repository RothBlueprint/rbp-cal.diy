import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { UsersModule } from "./users/users.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { AtomsModule } from "@/modules/atoms/atoms.module";
import { OAuth2Module } from "@/modules/auth/oauth2/oauth2.module";
import { CalUnifiedCalendarsModule } from "@/modules/cal-unified-calendars/cal-unified-calendars.module";
import { ConferencingModule } from "@/modules/conferencing/conferencing.module";
import { DestinationCalendarsModule } from "@/modules/destination-calendars/destination-calendars.module";
import { OAuthClientModule } from "@/modules/oauth-clients/oauth-client.module";
import { StripeModule } from "@/modules/stripe/stripe.module";
import { TeamsEventTypesModule } from "@/modules/teams/event-types/teams-event-types.module";
import { TimezoneModule } from "@/modules/timezones/timezones.module";
import { UsersAdminModule } from "@/modules/users/users-admin.module";
import { VerifiedResourcesModule } from "@/modules/verified-resources/verified-resources.module";
import { PlatformEndpointsModule } from "@/platform/platform-endpoints-module";

@Module({
  imports: [
    OAuth2Module,
    OAuthClientModule,
    PlatformEndpointsModule,
    TimezoneModule,
    UsersModule,
    WebhooksModule,
    DestinationCalendarsModule,
    AtomsModule,
    StripeModule,
    TeamsEventTypesModule,
    UsersAdminModule,
    ConferencingModule,
    CalUnifiedCalendarsModule,
    VerifiedResourcesModule,
  ],
})
export class EndpointsModule implements NestModule {
  configure(_consumer: MiddlewareConsumer) {
    // TODO: apply ratelimits
  }
}
