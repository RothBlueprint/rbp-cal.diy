import { Test } from "@nestjs/testing";
import { AppModule } from "@/app.module";
import { UsersAdminService } from "@/modules/users/services/users-admin.service";

/**
 * Dependency-injection smoke test for the admin-on-behalf-of surface.
 *
 * UsersAdminService reaches across four feature modules (schedules, bookings,
 * conferencing, calendars) to drive things on a user's behalf. Every one of those
 * dependencies has to be exported by the module that owns it, and TypeScript
 * cannot see that: a provider missing from an `exports` array typechecks
 * perfectly and then fails at runtime, on boot, taking the whole API down.
 *
 * Compiled through AppModule rather than UsersAdminModule alone, because several
 * modules in this graph rely on AppModule registering ConfigModule globally and
 * do not import it themselves — so a standalone compile fails for reasons that
 * have nothing to do with the module under test.
 *
 * `compile()` builds the injector without running lifecycle hooks, so this needs
 * no database, Redis or network.
 */
describe("UsersAdminService wiring", () => {
  it("resolves with all of its cross-module dependencies", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef.get(UsersAdminService, { strict: false })).toBeInstanceOf(UsersAdminService);
  });
});
