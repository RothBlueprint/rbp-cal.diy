-- Event-type-scoped webhooks are provisioned by an upsert keyed on
-- (eventTypeId, subscriberUrl). Without a constraint that upsert is a
-- find-then-create race: two overlapping provisioning calls both see no row and
-- both insert, after which every booking on that event type is delivered twice.
--
-- Rows with a NULL "eventTypeId" (user-, team- and oAuth-scoped webhooks) are not
-- affected: Postgres treats NULLs as distinct in a unique index.
BEGIN;

-- Duplicates cannot coexist with the index, but they are NOT collapsed here.
-- Two rows sharing a key can differ in eventTriggers, active, payloadTemplate,
-- secret or version, so picking a survivor would silently discard a subscription
-- someone depends on — in a scheduling system, that is invisible data loss of
-- exactly the kind UPSTREAM-BUGS.md exists to complain about. Fail the migration
-- instead and name the offending keys, so the operator decides what to keep.
--
-- No environment is expected to trip this: the API has always rejected a duplicate
-- (eventTypeId, subscriberUrl) with a 409.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(
           format('  eventTypeId=%s subscriberUrl=%s (%s rows: %s)',
                  "eventTypeId", "subscriberUrl", row_count, ids),
           E'\n' ORDER BY "eventTypeId")
    INTO duplicates
    FROM (
      SELECT "eventTypeId",
             "subscriberUrl",
             count(*) AS row_count,
             string_agg("id", ', ' ORDER BY "createdAt") AS ids
        FROM "public"."Webhook"
       WHERE "eventTypeId" IS NOT NULL
       GROUP BY "eventTypeId", "subscriberUrl"
      HAVING count(*) > 1
    ) grouped;

  IF duplicates IS NOT NULL THEN
    -- Literal newlines in the message, and a single `%` placeholder. RAISE's
    -- placeholder is bare `%`, not format()'s `%s`; `%s` substitutes and then emits a
    -- stray literal 's', and `%%` is an escaped percent rather than a second slot.
    RAISE EXCEPTION 'Cannot add unique index on Webhook(eventTypeId, subscriberUrl): duplicate rows exist.
Reconcile them by hand - keep the row whose eventTriggers/secret/active are correct, delete the rest - then re-run the migration:
%', duplicates;
  END IF;
END
$$;

CREATE UNIQUE INDEX "Webhook_eventTypeId_subscriberUrl_key"
  ON "public"."Webhook"("eventTypeId", "subscriberUrl");

COMMIT;
