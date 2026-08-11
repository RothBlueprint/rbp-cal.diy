import { UserCreationService } from "@calcom/platform-libraries";
import type { GetBookingsInput_2024_08_13 } from "@calcom/platform-types";
import { CreationSource } from "@calcom/prisma/client";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { ProvisionUserInput } from "@/modules/users/inputs/provision-user.input";
import { UsersRepository } from "@/modules/users/users.repository";
import { BookingsService_2024_08_13 } from "@/platform/bookings/2024-08-13/services/bookings.service";
import { SchedulesService_2024_06_11 } from "@/platform/schedules/schedules_2024_06_11/services/schedules.service";

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly schedulesService: SchedulesService_2024_06_11,
    private readonly bookingsService: BookingsService_2024_08_13
  ) {}

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

  async getUserBookings(userId: number, queryParams: GetBookingsInput_2024_08_13) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    // The shared bookings query scopes to the passed user context (organizer/attendee),
    // so substituting the target user returns that user's bookings.
    return await this.bookingsService.getBookings(queryParams, {
      id: user.id,
      email: user.email,
    });
  }
}
