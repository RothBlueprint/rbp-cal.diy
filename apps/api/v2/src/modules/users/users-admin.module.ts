import { Module } from "@nestjs/common";
import { ConferencingModule } from "@/modules/conferencing/conferencing.module";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersAdminController } from "@/modules/users/controllers/users-admin.controller";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";
import { UsersModule } from "@/modules/users/users.module";
import { WebhooksModule } from "@/modules/webhooks/webhooks.module";
import { BookingsModule_2024_08_13 } from "@/platform/bookings/2024-08-13/bookings.module";
import { CalendarsModule } from "@/platform/calendars/calendars.module";
import { EventTypesModule_2024_06_14 } from "@/platform/event-types/event-types_2024_06_14/event-types.module";
import { SchedulesModule_2024_06_11 } from "@/platform/schedules/schedules_2024_06_11/schedules.module";

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    MembershipsModule,
    SchedulesModule_2024_06_11,
    BookingsModule_2024_08_13,
    ConferencingModule,
    CalendarsModule,
    EventTypesModule_2024_06_14,
    WebhooksModule,
  ],
  providers: [UsersAdminService],
  controllers: [UsersAdminController],
})
export class UsersAdminModule {}
