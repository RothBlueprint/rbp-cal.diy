/**
 * rbp provisioning: creates the round-robin pool teams, their event types, and the
 * eventTypeId-scoped webhooks that notify the rbp application of bookings.
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

  let team = await prisma.team.findFirst({ where: { slug, parentId: null }, select: { id: true } });
  if (!team) {
    team = await prisma.team.create({ data: { name, slug }, select: { id: true } });
    console.log(`created team ${slug} (id ${team.id})`);
  } else {
    console.log(`team ${slug} exists (id ${team.id})`);
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
