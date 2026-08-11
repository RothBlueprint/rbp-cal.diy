import { Module } from "@nestjs/common";
import { ConferencingModule } from "@/modules/conferencing/conferencing.module";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { OrganizationsConferencingService } from "@/modules/organizations/conferencing/services/organizations-conferencing.service";
import { InputOrganizationsEventTypesService } from "@/modules/organizations/event-types/services/input.service";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { RedisModule } from "@/modules/redis/redis.module";
import { TeamsEventTypesController } from "@/modules/teams/event-types/controllers/teams-event-types.controller";
import { OutputTeamEventTypesResponsePipe } from "@/modules/teams/event-types/pipes/output-team-event-types-response.pipe";
import { OutputTeamEventTypesService } from "@/modules/teams/event-types/services/output-team-event-types.service";
import { TeamsEventTypesService } from "@/modules/teams/event-types/services/teams-event-types.service";
import { TeamsEventTypesRepository } from "@/modules/teams/event-types/teams-event-types.repository";
import { TeamsRepository } from "@/modules/teams/teams/teams.repository";
import { UsersModule } from "@/modules/users/users.module";
import { EventTypesModule_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/event-types.module";

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    MembershipsModule,
    EventTypesModule_2024_06_14,
    UsersModule,
    ConferencingModule,
  ],
  providers: [
    TeamsEventTypesRepository,
    TeamsEventTypesService,
    InputOrganizationsEventTypesService,
    OutputTeamEventTypesResponsePipe,
    OutputTeamEventTypesService,
    OrganizationsConferencingService,
    TeamsRepository,
  ],
  exports: [TeamsEventTypesRepository, TeamsEventTypesService],
  controllers: [TeamsEventTypesController],
})
export class TeamsEventTypesModule {}
