import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";

@Injectable()
export class IsSystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: ApiAuthGuardUser }>();

    if (!request.user?.isSystemAdmin) {
      throw new ForbiddenException("Only instance administrators can access this endpoint.");
    }

    return true;
  }
}
