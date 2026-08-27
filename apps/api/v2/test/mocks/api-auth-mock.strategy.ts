import { BaseStrategy } from "@/lib/passport/strategies/types";
import { ApiAuthGuardRequest } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { UsersService } from "@/modules/users/services/users.service";
import { UsersRepository } from "@/modules/users/users.repository";
import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";

@Injectable()
export class ApiAuthMockStrategy extends PassportStrategy(BaseStrategy, "api-auth") {
  constructor(
    private readonly email: string,
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService
  ) {
    super();
  }

  async authenticate(request: ApiAuthGuardRequest) {
    try {
      const user = await this.usersRepository.findByEmailWithProfile(this.email);
      if (!user) {
        throw new Error("User with the provided ID not found");
      }

      const organizationId = this.usersService.getUserMainOrgId(user) as number;
      request.organizationId = organizationId;

      // Mirrors ApiAuthStrategy.getSuccessUser. Without it request.user.isSystemAdmin
      // is undefined and IsSystemAdminGuard rejects every admin route under test,
      // however the fixture set the user's role.
      return this.success({ ...user, isSystemAdmin: user.role === "ADMIN" });
    } catch (error) {
      console.error(error);
      if (error instanceof Error) return this.error(error);
    }
  }
}
