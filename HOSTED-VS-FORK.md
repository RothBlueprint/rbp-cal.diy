# Hosted cal.com vs. this fork

Written to settle an open decision: the team is leaning toward hosted cal.com on the
Organizations plan plus a support contract, rather than running this fork.

This is a documentation-only analysis of cal.com's live v2 API reference and OpenAPI
spec as of 2026-08-13, checked against what we have actually built and deployed here.
No authenticated calls were made against a cal.com account. The acceptance test at the
bottom is what turns this from an argument into a fact, and it is cheap to run.

## The claim that started this

Cal.com sales told us:

> Cal.com can support a fully headless setup, allowing advisors to connect their
> calendars and conferencing tools while the agent-facing experience remains within
> Roth Blueprint.

**As worded, this does not hold for our advisors.** There is no documented mechanism by
which an advisor ends up with a connected calendar without personally authenticating to
cal.com. Every path was checked:

| Mechanism | Status |
| --- | --- |
| Platform / managed users | Closed to new signups as of 2025-12-15, per cal.com's own docs. Endpoints marked deprecated. |
| Delegation Credentials | Requires super-admin of the advisor's Google Workspace / M365 tenant. Structurally impossible for `gmail.com`. |
| API-driven calendar connect for another user | Does not exist. `GET /v2/calendars/{calendar}/connect` takes no `userId`; the credential binds to whoever the Bearer token identifies. There is no `/v2/organizations/{orgId}/users/{userId}/calendars` path in any form. |
| Programmatic login / impersonation | No endpoint. No magic-link or session-mint API. |
| SAML SSO | Real, on the Organizations plan — but cal.com is the Service Provider. The advisor still starts at a cal.com URL, and it assumes advisors are identities in our IdP. They are not; they are independent contractors on their own domains. |

The nearest real thing is `<OnboardingEmbed />`, documented under
[/docs/api-reference/v2/oauth](https://cal.com/docs/api-reference/v2/oauth). It renders
cal.com's signup and calendar-connect flow in an iframe on cal.com's domain, then hands
back an OAuth authorization code. With the `APPS_WRITE` scope we can afterward drive
that advisor's calendar and conferencing connections server-side.

That is cosmetically headless, not actually headless:

- The advisor creates and authenticates a real cal.com account.
- Cal.com emails the advisor a verification link, from cal.com, branded cal.com.
- The OAuth client requires **manual approval by a cal.com admin** before anyone other
  than the client owner can authorize against it. No SLA is published. That is a hard
  external gate on onboarding all 200 advisors.
- It ships as a React component, so our Django app needs a React island or a separate
  hosted page.

## What only the fork can do

Two things, and they are the two the business actually asked for.

**1. Transparent onboarding.** `apps/web/app/api/auth/rbp-sso/route.ts` mints a
short-lived single-use token and exchanges it for a NextAuth session. The advisor
clicks a button in rbp and lands inside the calendar app already signed in. They never
see a login screen, never receive mail from a vendor they have not heard of, and never
learn the product is called anything other than RothBlueprint. Hosted has no equivalent
and, given the endpoint inventory above, cannot be made to have one.

**2. Our own domain and our own brand, end to end.** We serve
`calendar.rothblueprint.com` with our logos and `hey@rothblueprint.com` as the support
address, set at the constant defaults in `packages/lib/constants.ts` rather than through
env vars. On hosted, custom domains are a **waitlist** feature
([cal.com/custom-domain-email-waitlist](https://cal.com/custom-domain-email-waitlist)) —
not purchasable today. The available fallback is the org subdomain
`rothblueprint.cal.com`. Logo, brand colors and hide-branding are settable via the API;
the domain is not.

A third, weaker point: option value. `Host.weight` and `Host.scheduleId` exist in
`packages/prisma/schema.prisma:68,72` but are absent from the `Host` DTO in
`packages/platform/types/event-types/event-types_2024_06_14/inputs/create-event-type.input.ts:616`.
Hosted has the identical gap — weighted round robin is a real product feature but is
UI-only, not in the documented API. The difference is that here it is a DTO change we
can make in an afternoon, and there it is a feature request we file and wait on. This
only matters if we ever want top producers to draw more leads than new hires. Nobody has
asked for that yet.

## What hosted does better

Stated plainly, because the fork's gaps are real and four of them are ours.

- **Team webhooks fire.** Ours do not — see `UPSTREAM-BUGS.md` #1 and #4. We work around
  it by scoping webhooks to `eventTypeId` and inserting rows directly.
- **Reassignment works.** Ours returns `200` and does nothing (#2). Hosted documents both
  auto and specific-host reassign.
- **`maxLeadThreshold` works.** Ours is settable and inert (#5).
- **Better reconciliation primitive.** `GET /v2/organizations/{orgId}/bookings` offers
  cursor pagination with `afterUpdatedAt` / `sortUpdatedAt`, which is a cleaner poller
  than what we built on `GET /v2/users/{id}/bookings`.
- **No migration surface, no patching, no on-call.** We currently carry 595 migrations
  against production Neon and own every future security update.
- **A support contract**, which is the thing the team actually wants and which no amount
  of correct code substitutes for.

Everything else reaches parity: provisioning with `autoAccept` + `skipNotificationEmail`,
accepted team membership, `metadata` on `POST /v2/bookings`, public slots, per-user
bookings reads, branding short of the domain.

## Cost

Organizations is $28/user/month. At ~200 advisors that is roughly $5,600/month, about
$67k/year, before any rate-limit uplift. **Confirm the seat model with sales before
treating this number as real** — whether inactive or bookable-only advisors count as
seats changes it substantially.

The fork runs on ECS Fargate plus Neon for a small fraction of that, and costs engineering
time instead. That trade is the actual decision. It is not obviously wrong to buy support.

Also worth pricing in: the default API rate limit is 120 requests/minute, shared across
everything Django does. Reconciliation polling across 200 advisors needs to be designed
against that ceiling, or negotiated upward.

## Acceptance test

Two calls settle the headless question. Run them against the existing trial with one
throwaway advisor on a **personal Gmail address**, because that is the shape of our real
population.

1. `POST /v2/organizations/{orgId}/users` with
   `{"email":"testadvisor@gmail.com","name":"Test Advisor","autoAccept":true,"skipNotificationEmail":true}`.
   Record the returned `userId`. Expect `201`, or `400 user_already_invited_or_member` if
   that Gmail already has a cal.com account.
2. Try to connect that user's calendar admin-side:
   - `GET /v2/calendars/google/connect?isDryRun=false` with the org API key. Predicted:
     returns a Google auth URL **for the key owner**, not for `userId`. There is no
     parameter to target the advisor.
   - `GET /v2/organizations/{orgId}/users/{userId}/calendars/google/connect`. Predicted:
     `404`, no such endpoint.

If both behave as predicted, the claim is falsified and no further testing is needed.

If we still want to proceed with hosted after that, the questions to get from sales **in
writing** before signing are:

- Does an advisor onboarded through `<OnboardingEmbed />` receive a cal.com-branded
  verification email? (Their docs say yes.)
- What is the approval SLA for an OAuth client, given it gates all 200 advisors?
- Can a `gmail.com` user hold an Organizations seat?
- Is custom domain available on any timeline, or is `rothblueprint.cal.com` the answer?
- Are booking webhooks retried, and on what schedule? Their docs are silent for
  `BOOKING_CREATED`; the retry language covers only `DELEGATION_CREDENTIAL_*` triggers.
  We already got burned by Calendly dropping webhooks, so assume at-most-once and keep
  the reconciliation poller either way.

## Recommendation

If the team's priority is support and not owning a fork, hosted is a defensible choice
and most of what we built ports over. Go in knowing you are trading away transparent
onboarding and `calendar.rothblueprint.com`, and that advisors will get mail from
cal.com during signup.

If transparent onboarding is a requirement rather than a preference, hosted cannot
deliver it today and the decision is already made.

Run the two-call test first. It costs ten minutes and it is the difference between
deciding on a sales claim and deciding on behavior.
