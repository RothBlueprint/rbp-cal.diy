-- Event-type-scoped webhooks are provisioned by an upsert keyed on
-- (eventTypeId, subscriberUrl). Without a constraint that upsert is a
-- find-then-create race: two overlapping provisioning calls both see no row and
-- both insert, after which every booking on that event type is delivered twice.
--
-- Rows with a NULL "eventTypeId" (user-, team- and oAuth-scoped webhooks) are not
-- affected: Postgres treats NULLs as distinct in a unique index.
BEGIN;

-- Collapse any pre-existing duplicates first, keeping the oldest row of each
-- group — that is the one that has been delivering, and keeping it preserves the
-- id any external system may already reference.
DELETE FROM "public"."Webhook" dup
USING "public"."Webhook" keep
WHERE dup."eventTypeId" IS NOT NULL
  AND dup."eventTypeId" = keep."eventTypeId"
  AND dup."subscriberUrl" = keep."subscriberUrl"
  AND (dup."createdAt", dup."id") > (keep."createdAt", keep."id");

CREATE UNIQUE INDEX "Webhook_eventTypeId_subscriberUrl_key"
  ON "public"."Webhook"("eventTypeId", "subscriberUrl");

COMMIT;
