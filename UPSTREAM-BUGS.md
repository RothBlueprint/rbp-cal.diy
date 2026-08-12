# Reportables

Bugs found while building on this fork that belong to someone else. Nothing here
is filed yet. Before filing, reproduce on a **clean checkout** of the relevant
upstream so we don't report something our own changes caused.

Most of these share one shape: the cal.diy refactor (`ab21c7f805`) replaced
commercial code with stubs that **silently succeed** instead of failing loudly, so
a feature looks wired up and quietly does nothing. That framing is probably worth
leading with in any issue.

Status: `unfiled` everywhere until someone changes it.

---

## 1. Team-scoped webhooks never fire · cal.diy · unfiled

**Highest value.** Silent data loss, trivial repro.

Booking flows pass `teamId: null` into the webhook subscriber lookup, so a Webhook
row scoped to a team is never matched:

- `packages/features/bookings/lib/service/RegularBookingService.ts:1465-1466, 1480-1481, 1489-1490`
- `packages/features/bookings/lib/handleCancelBooking.ts:198`
- `packages/features/bookings/lib/handleConfirmation.ts:319-320`

Upstream resolved it with `getTeamIdFromEventType` (see `git show ab21c7f805^` on
the same file, ~line 1612); the refactor dropped the call but kept the parameter.

Internally inconsistent, which strengthens the report: `BOOKING_REJECTED` still
resolves a real `teamId` (`confirm.handler.ts:445-461`).

**Repro:** create a team + team event type, add a `teamId`-scoped webhook for
`BOOKING_CREATED`, book it. Nothing is delivered. An `eventTypeId`-scoped webhook
on the same event type does fire.

**Workaround we use:** scope booking webhooks by `eventTypeId` (`scripts/rbp-setup.ts`).

## 2. Reassign endpoints return 200 and do nothing · cal.diy · unfiled

`POST /v2/bookings/:uid/reassign` and `/reassign/:userId` pass their guards and
respond `200` with the booking unchanged, because `roundRobinReassignment` and
`roundRobinManualReassignment` are empty stubs
(`packages/platform/libraries/index.ts:126-151`). A caller cannot tell the
difference between "reassigned" and "ignored". Should be `501`.

Same shape: `validateRoundRobinSlotAvailability` (`platform-libraries/slots.ts:13-21`)
returns `true` unconditionally, so `POST /v2/slots/reservations` no longer checks
whether another round-robin host is actually free — slots can be over-reserved.

## 3. `/bookings` hangs after selecting any segment · cal.diy · unfiled

User-visible, reproducible every time.

`useActiveFiltersValidator` (`apps/web/modules/bookings/hooks/useActiveFiltersValidator.ts:61,82`)
blocks until `teams !== undefined`, but `useFacetedUniqueValues.ts:19-20` hardcodes
`teams`/`members` to `undefined` since the teams tRPC router was removed. The
validator therefore never resolves, and `BookingListContainer.tsx:274` keeps the
bookings query disabled on `enabled: !isValidatorPending`.

**Repro:** open `/bookings`, pick any segment including the built-in "My bookings".
The list spins forever.

## 4. Event-type webhooks cannot be created for team event types · cal.diy · unfiled

`IsUserEventTypeWebhookGuard` requires `eventType.userId === user.id`
(`apps/api/v2/src/modules/webhooks/guards/is-user-event-type-webhook-guard.ts:40-44`).
Team event types have `userId = null`, so it always throws — with no admin or
team-role branch, and no alternative endpoint, since the team webhooks controller
was deleted. The tRPC path fails the same way
(`packages/trpc/server/routers/viewer/webhook/util.ts:60-62`).

Combined with #1 this means a self-hoster has **no supported way** to get booking
webhooks for a team event type. We insert the rows directly.

## 5. `maxLeadThreshold` is settable but inert · cal.diy · unfiled

The column exists (`schema.prisma:262`), is selected at booking time, and is
writable through the event-type update handler — but the QualifiedHosts DI module
(`packages/features/di/modules/QualifiedHosts.ts:14-78`) is a stub that never reads
it. Configuring it appears to work and changes nothing. Either wire it or reject
the field.

## 6. No confirmation emails when every conferencing integration fails · possibly cal.com too · unfiled

**Most valuable to other people, and the one to verify hardest**, because the logic
looks upstream-identical rather than fork-specific.

In `RegularBookingService.ts` (~2064) the confirmation-email call sits *inside* the
success branch:

```js
if (results.length > 0 && results.every((res) => !res.success)) {
    // log the failure — no emails
} else {
    ...
    if (!noEmail) { await emailsAndSmsHandler.send({ action: confirmed, ... }) }
}
```

So when the only conferencing integration fails, the booking is still created, the
API returns `201`, and **neither the attendee nor the organizer receives a
confirmation**. The organizer does get a separate "problem adding a video link"
notice, which makes it look like mail is working while the attendee hears nothing.

**Repro (we hit this live):** event type with Cal Video as its location, Daily app
not seeded, create a booking. Booking exists, attendee never told.

For a sales team that is a booked prospect who never gets a calendar invite. Even
if the meeting link genuinely cannot be created, the confirmation should still go
out.

## 7. `apps/api/v2/.env.example` omits `NEXT_PUBLIC_WEBAPP_URL` · cal.diy · unfiled

Papercut, but it cost us a production bug. The API defines its own
`app.baseUrl` from `WEB_APP_URL` (`apps/api/v2/src/config/app.ts:45`), while the
shared libraries it depends on build every user-facing link from
`NEXT_PUBLIC_WEBAPP_URL` (`packages/lib/constants.ts:23`). Set only the documented
one and bookings made through the API return `http://localhost:3000/video/...`
meeting links and `app.cal.com` reschedule links.

Either document both or have the API config fall back to `WEB_APP_URL`.

---

## Not theirs — ours

Recorded so nobody wastes time filing them.

- `localhost:3000` meeting links: our config (though see #7).
- Migration collision, GitHub immutable OIDC subject claim, ALB security-group
  drift: our repos and our infra code.
- `'record' is possibly 'null'` in the SSO route, and `biome check --write` adding
  `import process from "node:process"` to `constants.ts` and breaking the edge
  build: introduced while writing this fork. The second is a decent warning for
  anyone else here — the repo's own pre-commit only lints, never writes, so this
  never happens unless you reach for `--write` yourself.
