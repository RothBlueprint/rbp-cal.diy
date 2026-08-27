/**
 * rbp provisioning: creates the round-robin pool teams, their event types, and the
 * eventTypeId-scoped webhooks that notify the rbp application of bookings.
 *
 * Also sweeps every AGENT's personal event type and gives it the same webhook. Those
 * are created one at a time by rbp through POST /v2/users/{userId}/webhooks; this
 * sweep is the repair pass, for event types that predate that route or drifted.
 *
 * Idempotent: safe to re-run; existing teams/event types/webhooks are kept and updated.
 *
 * Webhooks must be eventTypeId-scoped in this fork: the booking flow passes teamId=null
 * to the webhook subscriber lookup, so team-scoped webhooks never fire.
 *
 * Config (env):
 *   RBP_POOL_COUNT        number of pools/teams (default 1)
 *   RBP_POOL_SLUG_PREFIX  team slug prefix (default "rbp-pool")
 *   RBP_EVENT_SLUG        event type slug (default "intro")
 *   RBP_EVENT_TITLE       event type title (default "Intro Call")
 *   RBP_EVENT_LENGTH      minutes (default 30)
 *   RBP_WEBHOOK_URL       rbp receiver endpoint; webhooks skipped when unset
 *   RBP_WEBHOOK_SECRET    HMAC secret for X-Cal-Signature-256 (required with URL)
 *
 * Run: yarn workspace @calcom/prisma rbp-setup
 */
import { randomUUID } from "crypto";
import * as dotenv from "dotenv";

// Real environment wins; .env files only fill gaps (cwd is packages/prisma when run via yarn)
dotenv.config();
dotenv.config({ path: "../../.env" });

import process from "node:process";
import prisma from "@calcom/prisma";
import { SchedulingType, WebhookTriggerEvents } from "@calcom/prisma/enums";

const POOL_COUNT = Number(process.env.RBP_POOL_COUNT ?? 1);
const SLUG_PREFIX = process.env.RBP_POOL_SLUG_PREFIX ?? "rbp-pool";
const EVENT_SLUG = process.env.RBP_EVENT_SLUG ?? "intro";
const EVENT_TITLE = process.env.RBP_EVENT_TITLE ?? "Intro Call";
const EVENT_LENGTH = Number(process.env.RBP_EVENT_LENGTH ?? 30);
const WEBHOOK_URL = process.env.RBP_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.RBP_WEBHOOK_SECRET;

const WEBHOOK_TRIGGERS: WebhookTriggerEvents[] = [
  WebhookTriggerEvents.BOOKING_CREATED,
  WebhookTriggerEvents.BOOKING_CANCELLED,
  WebhookTriggerEvents.BOOKING_RESCHEDULED,
  WebhookTriggerEvents.BOOKING_REJECTED,
];

async function ensurePool(index: number) {
  const slug = POOL_COUNT === 1 ? SLUG_PREFIX : `${SLUG_PREFIX}-${index}`;
  const name = POOL_COUNT === 1 ? "RBP Pool" : `RBP Pool ${index}`;

  // The booking page renders this as the profile image the lead sees, so it
  // carries the brand independently of the app chrome.
  const logoUrl = `${process.env.NEXT_PUBLIC_WEBAPP_URL ?? ""}/rbp-logo-dark.svg`;

  let team = await prisma.team.findFirst({ where: { slug, parentId: null }, select: { id: true } });
  if (!team) {
    team = await prisma.team.create({ data: { name, slug, logoUrl }, select: { id: true } });
    console.log(`created team ${slug} (id ${team.id})`);
  } else {
    await prisma.team.update({ where: { id: team.id }, data: { logoUrl } });
    console.log(`team ${slug} exists (id ${team.id}), logo refreshed`);
  }

  let eventType = await prisma.eventType.findFirst({
    where: { teamId: team.id, slug: EVENT_SLUG },
    select: { id: true },
  });
  if (!eventType) {
    eventType = await prisma.eventType.create({
      data: {
        title: EVENT_TITLE,
        slug: EVENT_SLUG,
        length: EVENT_LENGTH,
        schedulingType: SchedulingType.ROUND_ROBIN,
        // Instant ACCEPTED bookings: confirmation flows drop metadata (incl. leadId)
        // from the BOOKING_CREATED webhook payload and complicate quota counting.
        requiresConfirmation: false,
        team: { connect: { id: team.id } },
      },
      select: { id: true },
    });
    console.log(`  created event type ${EVENT_SLUG} (id ${eventType.id})`);
  } else {
    console.log(`  event type ${EVENT_SLUG} exists (id ${eventType.id})`);
  }

  if (WEBHOOK_URL) {
    if (!WEBHOOK_SECRET) throw new Error("RBP_WEBHOOK_SECRET is required when RBP_WEBHOOK_URL is set");
    const existing = await prisma.webhook.findFirst({
      where: { eventTypeId: eventType.id, subscriberUrl: WEBHOOK_URL },
      select: { id: true },
    });
    if (!existing) {
      await prisma.webhook.create({
        data: {
          id: randomUUID(),
          eventTypeId: eventType.id,
          subscriberUrl: WEBHOOK_URL,
          eventTriggers: WEBHOOK_TRIGGERS,
          secret: WEBHOOK_SECRET,
          active: true,
        },
      });
      console.log(`  created webhook -> ${WEBHOOK_URL}`);
    } else {
      await prisma.webhook.update({
        where: { id: existing.id },
        data: { eventTriggers: WEBHOOK_TRIGGERS, secret: WEBHOOK_SECRET, active: true },
      });
      console.log(`  webhook exists, refreshed (id ${existing.id})`);
    }
  } else {
    console.log("  RBP_WEBHOOK_URL not set - skipping webhook");
  }

  return { slug, teamId: team.id, eventTypeId: eventType.id };
}

/**
 * Give every personal `intro` event type an eventTypeId-scoped webhook.
 *
 * Personal event types are provisioned per agent by rbp, so this exists to repair
 * drift and to cover the agents created before POST /v2/users/{userId}/webhooks
 * existed at all — without it, a booking on an agent's own page notified nobody and
 * was only recovered by an hourly polling sweep, with reschedules and cancellations
 * lost entirely.
 *
 * `parentId: null` skips managed event type children: getWebhooks.ts already matches
 * those through their managed parent, so a row here would be a second subscriber.
 */
async function ensurePersonalWebhooks(webhookUrl: string, webhookSecret: string) {
  const eventTypes = await prisma.eventType.findMany({
    where: { slug: EVENT_SLUG, teamId: null, parentId: null, userId: { not: null } },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  });

  console.log(`\npersonal ${EVENT_SLUG} event types (${eventTypes.length}):`);

  for (const eventType of eventTypes) {
    // Narrowing only; the query already excluded nulls.
    const userId = eventType.userId as number;

    const existing = await prisma.webhook.findFirst({
      where: { eventTypeId: eventType.id, subscriberUrl: webhookUrl },
      select: { id: true },
    });

    if (existing) {
      await prisma.webhook.update({
        where: { id: existing.id },
        data: { eventTriggers: WEBHOOK_TRIGGERS, secret: webhookSecret, active: true },
      });
      console.log(`  eventType ${eventType.id} (user ${userId}): webhook ${existing.id} refreshed`);
      await warnOnUserScopedWebhooks(userId, webhookUrl);
      continue;
    }

    // Re-point a legacy user-scoped row instead of adding a second one. getWebhooks.ts
    // matches subscribers with a flat OR, so leaving it in place next to a new
    // event-type-scoped row would deliver this booking twice — and while it stands it
    // also fires on every pool booking the user hosts, which is the same double
    // delivery from the other direction.
    const userScoped = await prisma.webhook.findFirst({
      where: { userId, eventTypeId: null, teamId: null, subscriberUrl: webhookUrl },
      select: { id: true },
    });

    if (userScoped) {
      await prisma.webhook.update({
        where: { id: userScoped.id },
        data: {
          eventTypeId: eventType.id,
          userId: null,
          eventTriggers: WEBHOOK_TRIGGERS,
          secret: webhookSecret,
          active: true,
        },
      });
      console.log(
        `  eventType ${eventType.id} (user ${userId}): converted user-scoped webhook ${userScoped.id} to event-type scope`
      );
      await warnOnUserScopedWebhooks(userId, webhookUrl);
      continue;
    }

    const created = await prisma.webhook.create({
      data: {
        id: randomUUID(),
        eventTypeId: eventType.id,
        subscriberUrl: webhookUrl,
        eventTriggers: WEBHOOK_TRIGGERS,
        secret: webhookSecret,
        active: true,
      },
      select: { id: true },
    });
    console.log(`  eventType ${eventType.id} (user ${userId}): created webhook ${created.id}`);
  }
}

/**
 * A user-scoped row surviving next to an event-type-scoped one double-delivers. Report
 * rather than delete: this only happens when someone made a webhook by hand, and the
 * script has no way to tell which of the two they meant to keep.
 */
async function warnOnUserScopedWebhooks(userId: number, webhookUrl: string) {
  const leftovers = await prisma.webhook.findMany({
    where: { userId, eventTypeId: null, teamId: null, subscriberUrl: webhookUrl },
    select: { id: true },
  });

  for (const leftover of leftovers) {
    console.warn(
      `    WARNING: user-scoped webhook ${leftover.id} (user ${userId}) also targets ${webhookUrl}. It double-delivers alongside the event-type-scoped one and fires on pool bookings too - delete it by hand.`
    );
  }
}

async function ensureSignupDisabled() {
  // NEXT_PUBLIC_DISABLE_SIGNUP cannot do this: Next.js inlines NEXT_PUBLIC_*
  // during `next build`, so setting it at runtime (e.g. in an ECS task
  // definition) has no effect on the deployed bundle. The signup route also
  // consults this Feature row, which IS read at runtime — that is the
  // dependable switch. Agents are created by rbp via POST /v2/users, so public
  // signup stays closed.
  const feature = await prisma.feature.findUnique({ where: { slug: "disable-signup" } });
  if (!feature) {
    console.log("  disable-signup feature row missing - skipping");
    return;
  }
  if (feature.enabled) {
    console.log("  signup already disabled");
    return;
  }
  await prisma.feature.update({ where: { slug: "disable-signup" }, data: { enabled: true } });
  console.log("  disabled public signup (disable-signup feature)");
}

async function main() {
  await ensureSignupDisabled();
  const pools = [];
  for (let i = 1; i <= POOL_COUNT; i++) {
    pools.push(await ensurePool(i));
  }

  if (WEBHOOK_URL) {
    if (!WEBHOOK_SECRET) throw new Error("RBP_WEBHOOK_SECRET is required when RBP_WEBHOOK_URL is set");
    await ensurePersonalWebhooks(WEBHOOK_URL, WEBHOOK_SECRET);
  } else {
    console.log("\npersonal event type webhooks: RBP_WEBHOOK_URL not set - skipping");
  }

  console.log("\nrbp config summary:");
  for (const pool of pools) {
    console.log(
      `  pool=${pool.slug} teamId=${pool.teamId} eventTypeId=${pool.eventTypeId} bookingPath=/team/${pool.slug}/${EVENT_SLUG}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
