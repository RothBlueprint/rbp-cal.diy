# Project conventions

Auto-loaded into Claude Code's context every session. Keep it terse — every line
costs context budget. Codify only rules that have actually bitten us; don't
document the whole codebase here.

## What this repo is

A hard fork of [calcom/cal.diy](https://github.com/calcom/cal.diy) (itself the MIT
community edition of Cal.com), run by rothblueprint as the headless scheduling
engine behind `calendar.rothblueprint.com`. A Django app ("rbp",
`~/com_annuityos_django`) drives it over API v2 with an admin API key; leads book on
public team pages. **Teams-only** — no organizations, no billing, no Cal-hosted admin
UI. The mission is restoring/extending the round-robin REST surface that upstream
cal.diy deleted, and nothing else.

`upstream` remote = calcom/cal.diy (for pulling their updates); `origin` = us.

## Licensing boundary — do not cross

The current tree is MIT. But we restore deleted code from git history, and at the
pre-deletion commit the license was split. **Never copy verbatim from
`packages/features/ee/**`, `apps/api/v2/src/ee/**`, or `apps/api/v1/**`** — those were
Cal.com Commercial License (and v1 its own license). Re-implement that functionality
against the MIT tree instead. Files outside those paths were AGPLv3 — restorable, and
why the repo stays public. See `LICENSE-NOTES.md`.

## Restoring deleted code

Everything upstream removed is at `git show ab21c7f805^:<path>`. That deletion commit
also **renamed `apps/api/v2/src/ee/` → `src/platform/`** — rewrite `@/ee/…` imports to
`@/platform/…` in anything restored. Many "deleted" services survive relocated/renamed
(e.g. the team event-type output service + pipe); grep the current tree before
restoring a file, or you'll duplicate a live class.

## API v2 imports

`apps/api/v2` cannot import `@calcom/features` / `@calcom/trpc` directly (no tsconfig
path mapping — "module not found"). Re-export through
`packages/platform/libraries/index.ts` and import from `@calcom/platform-libraries`.
After editing that file, rebuild it: `yarn workspace @calcom/platform-libraries build`.

## Fork stubs — things that look wired but aren't

- **Round-robin reassignment is a no-op stub** (`platform-libraries/index.ts`).
  `POST /v2/bookings/:uid/reassign` returns 200 and changes nothing. Offboard via a
  hosts[] PATCH or cancel+rebook, not reassign.
- **Team-scoped webhooks never fire** — the booking flow passes `teamId: null` to the
  subscriber lookup. Scope booking webhooks by `eventTypeId`.
- **An admin API key cannot read other users' bookings** via `GET /v2/bookings` (the
  PBAC permission service is stubbed to `[]`). Use `GET /v2/users/:id/bookings`.

## Local dev

User-space stack via micromamba env `cal` (no Docker): Postgres :5450, Redis :6379.

```bash
yarn install
yarn workspace @calcom/prisma db-deploy && yarn workspace @calcom/prisma db-seed
yarn workspace @calcom/prisma rbp-setup     # pool teams + RR event types + webhooks
yarn workspace @calcom/api-v2 dev           # API :5555  (needs Redis + Neon/pg)
yarn workspace @calcom/web dev              # web :3000
```

Prisma enum values are **camelCase in the DB**: `schedulingType = 'roundRobin'` (not
`ROUND_ROBIN`), `MembershipRole` is `MEMBER|OWNER|ADMIN`. `users.uuid` is NOT-NULL with
no default — set `gen_random_uuid()` in raw inserts.

## Type checking

`yarn type-check:ci --force` is the gate; **main is clean (0 errors)** — diff against
that, not zero-in-the-abstract. The turbo task uses `tsc-absolute`; running it directly
in a workspace fails with exit 127. For a scoped check use
`cd apps/web && npx tsc --noEmit` (or `apps/api/v2`). A pre-existing failure in
`apps/api/v2/test/mocks/calendars-service-mock.ts` (references `@/ee`) exists on main —
ignore it.

## Prisma queries

Use `select`, never `include` — smaller payloads and no accidental exposure of
sensitive fields (`credential.key`, password hashes). Applies everywhere.

## Deployment

No infra lives in this repo — only the Dockerfiles and `.github/workflows/`. Deployment
is a `CalendarStack` in the rbp repo's cdktf infra (`~/com_annuityos_django/infra/cdktf`,
modeled on `stacks/metabase.py`): two Fargate services (cal-web :3000, cal-api :5555)
behind the shared ALB, a dedicated Neon database, and an ElastiCache Serverless Valkey.
`.github/workflows/build-images.yml` builds+pushes GHCR images and (once repo variables
are set) deploys via `.github/scripts/cal-deploy.sh`.

## Commits

Conventional commits (`feat:`, `fix:`, `ci:`, `docs:`). **No `Co-Authored-By: Claude`
trailer** (matches the rbp Django repo convention).
