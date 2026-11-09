import { Module } from "@nestjs/common";
import { PrismaBookingRepository } from "@/lib/repositories/prisma-booking.repository";
import { PrismaEventTypeRepository } from "@/lib/repositories/prisma-event-type.repository";
import { PrismaHolidayRepository } from "@/lib/repositories/prisma-holiday.repository";
import { PrismaOOORepository } from "@/lib/repositories/prisma-ooo.repository";
import { UserAvailabilityService } from "@/lib/services/user-availability.service";
import { ConferencingModule } from "@/modules/conferencing/conferencing.module";
import { CredentialsRepository } from "@/modules/credentials/credentials.repository";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { RedisModule } from "@/modules/redis/redis.module";
import { UsersAdminController } from "@/modules/users/controllers/users-admin.controller";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";
import { UsersAdminAvailabilityService } from "@/modules/users/services/users-admin-availability.service";
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
    RedisModule,
  ],
  providers: [
    UsersAdminService,
    CredentialsRepository,
    // GET /:userId/availability-check: Cal's UserAvailabilityService and what it
    // is built from (see lib/modules/available-slots.module.ts).
    UsersAdminAvailabilityService,
    UserAvailabilityService,
    PrismaOOORepository,
    PrismaBookingRepository,
    PrismaEventTypeRepository,
    PrismaHolidayRepository,
  ],
  controllers: [UsersAdminController],
})
export class UsersAdminModule {}
