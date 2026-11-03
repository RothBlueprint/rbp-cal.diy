import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import type { PrismaClient } from "@calcom/prisma";

import type { IAvailableSlotsService } from "./util";
import { AvailableSlotsService } from "./util";

// rbp: the team booker sends `usernameList: [teamSlug]` with `isTeamEvent`.
// Every agent's personal event type shares the pool's slug ("intro"), so if
// the team slug is looked up as a username the slots come from some agent's
// personal page while the booking is checked against the pool.
describe("AvailableSlotsService - getEventTypeId", () => {
  type GetEventTypeId = (args: {
    slug?: string;
    eventTypeSlug?: string;
    isTeamEvent: boolean;
    organizationDetails?: { currentOrgDomain: string | null; isValidOrgDomain: boolean };
  }) => Promise<number | null>;

  let deps: {
    userRepo: { findUsersByUsername: ReturnType<typeof vi.fn> };
    eventTypeRepo: {
      findTeamEventTypeIdBySlugs: ReturnType<typeof vi.fn>;
      findFirstEventTypeId: ReturnType<typeof vi.fn>;
    };
  };
  let getEventTypeId: GetEventTypeId;

  beforeEach(() => {
    deps = {
      userRepo: { findUsersByUsername: vi.fn().mockResolvedValue([]) },
      eventTypeRepo: {
        findTeamEventTypeIdBySlugs: vi.fn().mockResolvedValue({ id: 4 }),
        findFirstEventTypeId: vi.fn().mockResolvedValue({ id: 999 }),
      },
    };
    const service = new AvailableSlotsService(deps as unknown as IAvailableSlotsService);
    getEventTypeId = (service as unknown as { getEventTypeId: GetEventTypeId }).getEventTypeId.bind(service);
  });

  it("resolves a team event by the team's slug, not as a username", async () => {
    const id = await getEventTypeId({ slug: "rbp-pool", eventTypeSlug: "intro", isTeamEvent: true });

    expect(id).toBe(4);
    expect(deps.eventTypeRepo.findTeamEventTypeIdBySlugs).toHaveBeenCalledWith({
      teamSlug: "rbp-pool",
      slug: "intro",
      orgSlug: null,
    });
    expect(deps.userRepo.findUsersByUsername).not.toHaveBeenCalled();
    expect(deps.eventTypeRepo.findFirstEventTypeId).not.toHaveBeenCalled();
  });

  it("refuses an unknown team instead of falling back", async () => {
    deps.eventTypeRepo.findTeamEventTypeIdBySlugs.mockResolvedValue(null);

    await expect(
      getEventTypeId({ slug: "no-such-team", eventTypeSlug: "intro", isTeamEvent: true })
    ).rejects.toThrow();
    expect(deps.eventTypeRepo.findFirstEventTypeId).not.toHaveBeenCalled();
  });

  it("still resolves a personal event by username", async () => {
    deps.userRepo.findUsersByUsername.mockResolvedValue([{ id: 32 }]);

    const id = await getEventTypeId({ slug: "martin", eventTypeSlug: "intro", isTeamEvent: false });

    expect(id).toBe(999);
    expect(deps.eventTypeRepo.findFirstEventTypeId).toHaveBeenCalledWith({ slug: "intro", userId: 32 });
    expect(deps.eventTypeRepo.findTeamEventTypeIdBySlugs).not.toHaveBeenCalled();
  });
});

describe("EventTypeRepository.findFirstEventTypeId", () => {
  it("returns nothing without an owner, instead of the first event type with the slug", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 999 });
    const repo = new EventTypeRepository({ eventType: { findFirst } } as unknown as PrismaClient);

    expect(await repo.findFirstEventTypeId({ slug: "intro" })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("scopes a team lookup to a top-level team", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 4 });
    const repo = new EventTypeRepository({ eventType: { findFirst } } as unknown as PrismaClient);

    await repo.findTeamEventTypeIdBySlugs({ teamSlug: "rbp-pool", slug: "intro", orgSlug: null });

    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: "intro", team: { slug: "rbp-pool", parentId: null } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
  });
});
