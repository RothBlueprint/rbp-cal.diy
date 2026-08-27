import type { EventType, Team } from "@calcom/prisma/client";
import { INestApplication } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { EventTypesRepositoryFixture } from "test/fixtures/repository/event-types.repository.fixture";
import { TeamRepositoryFixture } from "test/fixtures/repository/team.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { WebhookRepositoryFixture } from "test/fixtures/repository/webhooks.repository.fixture";
import { randomString } from "test/utils/randomString";
import { withApiAuth } from "test/utils/withApiAuth";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { TokensModule } from "@/modules/tokens/tokens.module";
import { UsersModule } from "@/modules/users/users.module";
import { UserWithProfile } from "@/modules/users/users.repository";
import { UpsertUserWebhookInputDto } from "@/modules/webhooks/inputs/admin-user-webhook.input";
import { EventTypeWebhookOutputResponseDto } from "@/modules/webhooks/outputs/event-type-webhook.output";

// Compiling AppModule and standing up the fixtures runs well past jest's 5s default
// hook timeout on a cold cache.
const HOOK_TIMEOUT_MS = 60_000;
const SUBSCRIBER_URL = "https://example.com/leads/cal_webhook";
const TRIGGERS = ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "BOOKING_REJECTED"];

/**
 * POST /v2/users/{userId}/webhooks — the route that lets a holder of the admin API
 * key provision a webhook for an ARBITRARY agent's personal event type. The public
 * POST /v2/webhooks cannot: it creates for whoever the bearer token is.
 */
describe("UsersAdminController webhooks (e2e)", () => {
  let app: INestApplication;

  const adminEmail = `users-admin-webhooks-admin-${randomString()}@api.com`;
  const agentEmail = `users-admin-webhooks-agent-${randomString()}@api.com`;
  const otherAgentEmail = `users-admin-webhooks-other-${randomString()}@api.com`;

  let userRepositoryFixture: UserRepositoryFixture;
  let eventTypesRepositoryFixture: EventTypesRepositoryFixture;
  let webhookRepositoryFixture: WebhookRepositoryFixture;
  let teamRepositoryFixture: TeamRepositoryFixture;

  let admin: UserWithProfile;
  let agent: UserWithProfile;
  let otherAgent: UserWithProfile;

  let agentEventType: EventType;
  let concurrencyEventType: EventType;
  let managedChildEventType: EventType;
  let otherAgentEventType: EventType;
  let team: Team;
  let teamEventType: EventType;

  let createdWebhookId: string;

  beforeAll(async () => {
    const moduleRef = await withApiAuth(
      adminEmail,
      Test.createTestingModule({
        imports: [AppModule, PrismaModule, UsersModule, TokensModule],
      })
    ).compile();

    userRepositoryFixture = new UserRepositoryFixture(moduleRef);
    eventTypesRepositoryFixture = new EventTypesRepositoryFixture(moduleRef);
    webhookRepositoryFixture = new WebhookRepositoryFixture(moduleRef);
    teamRepositoryFixture = new TeamRepositoryFixture(moduleRef);

    // role ADMIN is what ApiAuthStrategy turns into isSystemAdmin, which is the only
    // thing IsSystemAdminGuard looks at.
    admin = await userRepositoryFixture.create({
      email: adminEmail,
      username: adminEmail,
      role: "ADMIN",
    });

    agent = await userRepositoryFixture.create({ email: agentEmail, username: agentEmail });
    otherAgent = await userRepositoryFixture.create({
      email: otherAgentEmail,
      username: otherAgentEmail,
    });

    agentEventType = await eventTypesRepositoryFixture.create(
      { title: "Intro Call", slug: `intro-${randomString(6)}`, length: 30 },
      agent.id
    );
    otherAgentEventType = await eventTypesRepositoryFixture.create(
      { title: "Intro Call", slug: `intro-${randomString(6)}`, length: 30 },
      otherAgent.id
    );
    // Kept clean for the concurrency test, which needs a pair with no row yet.
    concurrencyEventType = await eventTypesRepositoryFixture.create(
      { title: "Intro Call", slug: `intro-${randomString(6)}`, length: 30 },
      agent.id
    );

    // A managed child looks personal — the member's userId, a null teamId — but the
    // subscriber lookup resolves its parentId and matches the parent's webhooks too.
    managedChildEventType = await eventTypesRepositoryFixture.create(
      {
        title: "Managed Intro",
        slug: `managed-intro-${randomString(6)}`,
        length: 30,
        parent: { connect: { id: agentEventType.id } },
      },
      agent.id
    );

    team = await teamRepositoryFixture.create({
      name: `users-admin-webhooks-team-${randomString(6)}`,
    });
    teamEventType = await eventTypesRepositoryFixture.createTeamEventType({
      title: "Pool Intro",
      slug: `pool-intro-${randomString(6)}`,
      length: 30,
      team: { connect: { id: team.id } },
    });

    app = moduleRef.createNestApplication();
    bootstrap(app as NestExpressApplication);
    await app.init();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await eventTypesRepositoryFixture.delete(managedChildEventType.id);
    await eventTypesRepositoryFixture.delete(teamEventType.id);
    await teamRepositoryFixture.delete(team.id);
    // Users cascade to their event types, which cascade to the webhooks under test.
    await userRepositoryFixture.deleteByEmail(admin.email);
    await userRepositoryFixture.deleteByEmail(agent.email);
    await userRepositoryFixture.deleteByEmail(otherAgent.email);
    await app.close();
  }, HOOK_TIMEOUT_MS);

  it("creates an event-type-scoped webhook for another user's personal event type", async () => {
    const body: UpsertUserWebhookInputDto = {
      eventTypeId: agentEventType.id,
      subscriberUrl: SUBSCRIBER_URL,
      eventTriggers: TRIGGERS as UpsertUserWebhookInputDto["eventTriggers"],
      secret: "a-shared-secret",
    };

    const response = await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send(body)
      .expect(200);

    const data = (response.body as EventTypeWebhookOutputResponseDto).data;
    expect(data).toMatchObject({
      id: expect.any(String),
      eventTypeId: agentEventType.id,
      subscriberUrl: SUBSCRIBER_URL,
      triggers: TRIGGERS,
      active: true,
    });

    createdWebhookId = data.id;

    // The scope is the whole point: a userId-scoped row would also match this agent's
    // round-robin pool bookings and deliver them twice, and a teamId-scoped row would
    // never fire at all (UPSTREAM-BUGS.md #1).
    const stored = await webhookRepositoryFixture.getById(createdWebhookId);
    expect(stored?.eventTypeId).toEqual(agentEventType.id);
    expect(stored?.userId).toBeNull();
    expect(stored?.teamId).toBeNull();
    expect(stored?.secret).toEqual("a-shared-secret");
    // rbp parses the v2021-10-20 payload shape; nothing here may bump it.
    expect(stored?.version).toEqual("2021-10-20");
  });

  it("is idempotent — a repeat call refreshes in place instead of adding a subscriber", async () => {
    const body: UpsertUserWebhookInputDto = {
      eventTypeId: agentEventType.id,
      subscriberUrl: SUBSCRIBER_URL,
      eventTriggers: ["BOOKING_CREATED"] as UpsertUserWebhookInputDto["eventTriggers"],
    };

    const response = await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send(body)
      .expect(200);

    expect(response.body.data.id).toEqual(createdWebhookId);
    expect(response.body.data.triggers).toEqual(["BOOKING_CREATED"]);

    const all = await webhookRepositoryFixture.getAllByEventTypeId(agentEventType.id);
    expect(all).toHaveLength(1);
    // secret was omitted from the body, so the working one must survive — clearing it
    // would silently break signature verification on the receiver.
    expect(all[0].secret).toEqual("a-shared-secret");
  });

  it("creates exactly one webhook under concurrent first-time calls", async () => {
    // The find-then-create this replaced had a TOCTOU window: overlapping calls — a
    // double activation, or a retry after a request timed out at the ALB but still
    // landed — both saw no row and both inserted, and the event type then delivered
    // every booking twice. Guarded by @@unique([eventTypeId, subscriberUrl]).
    const body = {
      eventTypeId: concurrencyEventType.id,
      subscriberUrl: SUBSCRIBER_URL,
      eventTriggers: TRIGGERS,
      secret: "a-shared-secret",
    };

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app.getHttpServer()).post(`/v2/users/${agent.id}/webhooks`).send(body)
      )
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);

    const all = await webhookRepositoryFixture.getAllByEventTypeId(concurrencyEventType.id);
    expect(all).toHaveLength(1);
    expect(new Set(responses.map((r) => r.body.data.id))).toEqual(new Set([all[0].id]));
  });

  it("reactivates a webhook that had been disabled", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({
        eventTypeId: agentEventType.id,
        subscriberUrl: SUBSCRIBER_URL,
        eventTriggers: TRIGGERS,
        active: false,
      })
      .expect(200)
      .then((res) => expect(res.body.data.active).toBe(false));

    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({ eventTypeId: agentEventType.id, subscriberUrl: SUBSCRIBER_URL, eventTriggers: TRIGGERS })
      .expect(200)
      .then((res) => expect(res.body.data.active).toBe(true));
  });

  it("rejects an event type owned by a different user", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({
        eventTypeId: otherAgentEventType.id,
        subscriberUrl: SUBSCRIBER_URL,
        eventTriggers: TRIGGERS,
      })
      .expect(403);

    const all = await webhookRepositoryFixture.getAllByEventTypeId(otherAgentEventType.id);
    expect(all).toHaveLength(0);
  });

  it("rejects a managed event type child", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({
        eventTypeId: managedChildEventType.id,
        subscriberUrl: SUBSCRIBER_URL,
        eventTriggers: TRIGGERS,
      })
      .expect(400);

    const all = await webhookRepositoryFixture.getAllByEventTypeId(managedChildEventType.id);
    expect(all).toHaveLength(0);
  });

  it("rejects a team event type", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({ eventTypeId: teamEventType.id, subscriberUrl: SUBSCRIBER_URL, eventTriggers: TRIGGERS })
      .expect(400);
  });

  it("404s on an unknown event type", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({ eventTypeId: 999999999, subscriberUrl: SUBSCRIBER_URL, eventTriggers: TRIGGERS })
      .expect(404);
  });

  it("404s on an unknown user", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/999999999/webhooks`)
      .send({ eventTypeId: agentEventType.id, subscriberUrl: SUBSCRIBER_URL, eventTriggers: TRIGGERS })
      .expect(404);
  });

  it("rejects an invalid trigger", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${agent.id}/webhooks`)
      .send({ eventTypeId: agentEventType.id, subscriberUrl: SUBSCRIBER_URL, eventTriggers: ["NOPE"] })
      .expect(400);
  });
});

describe("UsersAdminController webhooks (e2e) - non-admin caller", () => {
  let app: INestApplication;

  const userEmail = `users-admin-webhooks-nonadmin-${randomString()}@api.com`;
  let userRepositoryFixture: UserRepositoryFixture;
  let eventTypesRepositoryFixture: EventTypesRepositoryFixture;
  let user: UserWithProfile;
  let eventType: EventType;

  beforeAll(async () => {
    const moduleRef = await withApiAuth(
      userEmail,
      Test.createTestingModule({
        imports: [AppModule, PrismaModule, UsersModule, TokensModule],
      })
    ).compile();

    userRepositoryFixture = new UserRepositoryFixture(moduleRef);
    eventTypesRepositoryFixture = new EventTypesRepositoryFixture(moduleRef);

    user = await userRepositoryFixture.create({ email: userEmail, username: userEmail });
    eventType = await eventTypesRepositoryFixture.create(
      { title: "Intro Call", slug: `intro-${randomString(6)}`, length: 30 },
      user.id
    );

    app = moduleRef.createNestApplication();
    bootstrap(app as NestExpressApplication);
    await app.init();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await userRepositoryFixture.deleteByEmail(user.email);
    await app.close();
  }, HOOK_TIMEOUT_MS);

  it("403s for a caller who is not an instance admin, even on their own event type", async () => {
    await request(app.getHttpServer())
      .post(`/v2/users/${user.id}/webhooks`)
      .send({ eventTypeId: eventType.id, subscriberUrl: SUBSCRIBER_URL, eventTriggers: TRIGGERS })
      .expect(403);
  });
});
