import { UserWithProfile } from "@/modules/users/users.repository";

export class BaseStrategy {
  success!: (user: unknown) => void;
  error!: (error: Error) => void;

  /**
   * Never invoked. These strategies override `authenticate` and hand the user straight
   * to `success()`, rather than using passport's verify-callback flow — so there is no
   * verify step for passport to call this from. Nest 11's PassportStrategy mixin
   * declares `validate` abstract, so the member has to exist for the subclasses to be
   * concrete.
   *
   * It throws rather than returning null: a refactor that starts routing through the
   * callback flow should fail loudly, not silently authenticate nobody.
   */
  validate(...args: unknown[]): never {
    throw new Error(
      `${this.constructor.name} authenticates in authenticate(); validate() is not part of its flow (called with ${args.length} args)`
    );
  }
}

export class NextAuthPassportStrategy {
  success!: (user: UserWithProfile) => void;
  error!: (error: Error) => void;

  /**
   * Never invoked. These strategies override `authenticate` and hand the user straight
   * to `success()`, rather than using passport's verify-callback flow — so there is no
   * verify step for passport to call this from. Nest 11's PassportStrategy mixin
   * declares `validate` abstract, so the member has to exist for the subclasses to be
   * concrete.
   *
   * It throws rather than returning null: a refactor that starts routing through the
   * callback flow should fail loudly, not silently authenticate nobody.
   */
  validate(...args: unknown[]): never {
    throw new Error(
      `${this.constructor.name} authenticates in authenticate(); validate() is not part of its flow (called with ${args.length} args)`
    );
  }
}
