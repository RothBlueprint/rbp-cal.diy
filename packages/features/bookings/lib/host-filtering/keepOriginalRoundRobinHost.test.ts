import prismock from "@calcom/testing/lib/__mocks__/prisma";
import { BookingStatus, MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keepOriginalRoundRobinHost } from "./getFilterHostsService";

// The prod shape this exists for (2026-09-24): pool event type 4 on team 1.
// Agent 11 was drawn for the client, then left the pool when their paid
// appointments ran out; agents 4 and 14 were still in it.
const TEAM_ID = 1;
const POOL_EVENT_TYPE_ID = 4;
const PERSONAL_EVENT_TYPE_ID = 15;
const AGENT_ON_MEETING = { id: 11, email: "agent-on-meeting@example.com" };
const POOL_AGENT_A = { id: 4, email: "pool-agent-a@example.com" };
const POOL_AGENT_B = { id: 14, email: "pool-agent-b@example.com" };
const RESCHEDULE_UID = "orig-booking-uid";

const asHost = (user: { id: number; email: string }) => ({ isFixed: false as const, user });

async function seed({
  bookingEventTypeId = POOL_EVENT_TYPE_ID,
  agentStillOnTeam = true,
}: {
  bookingEventTypeId?: number;
  agentStillOnTeam?: boolean;
} = {}) {
  await prismock.team.create({ data: { id: TEAM_ID, name: "rbp-pool", slug: "rbp-pool" } });
  for (const user of [AGENT_ON_MEETING, POOL_AGENT_A, POOL_AGENT_B]) {
    await prismock.user.create({ data: { ...user, username: `user-${user.id}` } });
  }
  await prismock.eventType.create({
    data: {
      id: POOL_EVENT_TYPE_ID,
      title: "Intro Call",
      slug: "intro",
      length: 30,
      teamId: TEAM_ID,
      schedulingType: SchedulingType.ROUND_ROBIN,
      rescheduleWithSameRoundRobinHost: true,
    },
  });
  await prismock.eventType.create({
    data: {
      id: PERSONAL_EVENT_TYPE_ID,
      title: "Intro",
      slug: "intro",
      length: 30,
      userId: AGENT_ON_MEETING.id,
    },
  });
  await prismock.membership.create({
    data: {
      userId: AGENT_ON_MEETING.id,
      teamId: TEAM_ID,
      accepted: agentStillOnTeam,
      role: MembershipRole.MEMBER,
    },
  });
  await prismock.credential.create({
    data: { id: 22, userId: AGENT_ON_MEETING.id, type: "office365_calendar", key: {} },
  });
  await prismock.selectedCalendar.create({
    data: {
      userId: AGENT_ON_MEETING.id,
      integration: "office365_calendar",
      externalId: "agent-on-meeting-cal",
      credentialId: 22,
    },
  });
  await prismock.booking.create({
    data: {
      uid: RESCHEDULE_UID,
      title: "Intro Call with a client",
      startTime: new Date("2026-09-24T17:00:00Z"),
      endTime: new Date("2026-09-24T17:30:00Z"),
      userId: AGENT_ON_MEETING.id,
      eventTypeId: bookingEventTypeId,
      status: BookingStatus.ACCEPTED,
      attendees: { create: [{ email: "client@example.com", name: "Client", timeZone: "UTC" }] },
    },
  });
}

describe("keepOriginalRoundRobinHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the host from the list when the agent on the meeting is still in it", async () => {
    await seed();
    const toHost = vi.fn();
    const agentInPool = asHost(AGENT_ON_MEETING);

    const result = await keepOriginalRoundRobinHost({
      hosts: [asHost(POOL_AGENT_A), agentInPool],
      rescheduleUid: RESCHEDULE_UID,
      eventTypeId: POOL_EVENT_TYPE_ID,
      teamId: TEAM_ID,
      toHost,
    });

    expect(result).toEqual([agentInPool]);
    expect(toHost).not.toHaveBeenCalled();
  });

  it("keeps the client with their agent after the agent has left the pool", async () => {
    await seed();

    const result = await keepOriginalRoundRobinHost({
      // The agent on the meeting is gone from the hosts list. The old rule read this as "fall
      // through to everyone" and the round robin drew another agent.
      hosts: [asHost(POOL_AGENT_A), asHost(POOL_AGENT_B)],
      rescheduleUid: RESCHEDULE_UID,
      eventTypeId: POOL_EVENT_TYPE_ID,
      teamId: TEAM_ID,
      toHost: (user) => ({ isFixed: false as const, user }),
    });

    expect(result.map((host) => host.user.id)).toEqual([AGENT_ON_MEETING.id]);
    // Loaded as a stand-in host, so availability can read their calendar.
    const [{ user }] = result as unknown as [
      { user: { credentials: { type: string }[]; userLevelSelectedCalendars: unknown[] } },
    ];
    expect(user.credentials.map((credential) => credential.type)).toEqual(["office365_calendar"]);
    expect(user.userLevelSelectedCalendars).toHaveLength(1);
  });

  it("reaches past a routed-down list too, since routing is only a preference", async () => {
    await seed();

    const result = await keepOriginalRoundRobinHost({
      // What the booking path sees after same-state routing narrowed it.
      hosts: [asHost(POOL_AGENT_B)],
      rescheduleUid: RESCHEDULE_UID,
      eventTypeId: POOL_EVENT_TYPE_ID,
      teamId: TEAM_ID,
      toHost: (user) => ({ isFixed: false as const, user }),
    });

    expect(result.map((host) => host.user.id)).toEqual([AGENT_ON_MEETING.id]);
  });

  it("lets go once the agent has left the team — an admin's move", async () => {
    await seed({ agentStillOnTeam: false });

    const result = await keepOriginalRoundRobinHost({
      hosts: [asHost(POOL_AGENT_A), asHost(POOL_AGENT_B)],
      rescheduleUid: RESCHEDULE_UID,
      eventTypeId: POOL_EVENT_TYPE_ID,
      teamId: TEAM_ID,
      toHost: (user) => ({ isFixed: false as const, user }),
    });

    expect(result).toEqual([]);
  });

  it("will not pull in a host through a rescheduleUid from another event type", async () => {
    // The uid rides on the request. Without this, pointing a pool booking at any
    // team member's personal booking would make them the host.
    await seed({ bookingEventTypeId: PERSONAL_EVENT_TYPE_ID });

    const result = await keepOriginalRoundRobinHost({
      hosts: [asHost(POOL_AGENT_A), asHost(POOL_AGENT_B)],
      rescheduleUid: RESCHEDULE_UID,
      eventTypeId: POOL_EVENT_TYPE_ID,
      teamId: TEAM_ID,
      toHost: (user) => ({ isFixed: false as const, user }),
    });

    expect(result).toEqual([]);
  });
});
