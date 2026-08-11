import { SUCCESS_STATUS } from "@calcom/platform-constants";
import type { GetBookingsInput_2024_08_13, GetBookingsOutput_2024_08_13 } from "@calcom/platform-types";
import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags as DocsTags } from "@nestjs/swagger";
import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { API_KEY_HEADER } from "@/lib/docs/headers";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { IsSystemAdminGuard } from "@/modules/auth/guards/system-admin/is-system-admin.guard";
import { ProvisionUserInput } from "@/modules/users/inputs/provision-user.input";
import { ProvisionUserOutput } from "@/modules/users/outputs/provision-user.output";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";

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
}
