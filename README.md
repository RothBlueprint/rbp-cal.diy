# rbp-cal.diy

**A hard fork of [calcom/cal.diy](https://github.com/calcom/cal.diy)** (the MIT community
edition of [Cal.com](https://github.com/calcom/cal.com)), maintained by rothblueprint as the
scheduling engine behind `calendar.rothblueprint.com`.

> [!IMPORTANT]
> **This fork is not accepting contributions.** No issues, no pull requests, no support.
> It exists for one deployment and diverges from upstream deliberately. If you want a
> self-hostable community scheduling platform, use the original
> [calcom/cal.diy](https://github.com/calcom/cal.diy); for commercial, enterprise-ready
> scheduling infrastructure, use [Cal.com](https://cal.com).

## What this fork changes

Upstream cal.diy removed Cal.com's commercial code wholesale (commit `ab21c7f805`),
which also removed the REST surface needed to drive team round-robin scheduling from an
external system. This fork restores and extends exactly that, and nothing else:

- `POST/GET/PATCH/DELETE /v2/teams/:teamId/event-types` — API-driven round-robin host
  management (restored from this repository's own pre-deletion history)
- `POST /v2/users` + `GET /v2/users/:userId/bookings` — admin-only user provisioning and
  per-user booking reconciliation (new)
- `/team/:slug/:type` + `/team/:slug/:type/embed` — the public team booking pages (restored)
- `scripts/rbp-setup.ts` — idempotent provisioning of pool teams, round-robin event types,
  and booking webhooks (new)

Everything else — the round-robin engine, slots, bookings, webhooks — is upstream code,
untouched.

## Provenance and licensing

The current tree is MIT-licensed by Cal.com, Inc. (see `LICENSE`). Files restored from
pre-relicense history originate from the AGPLv3-licensed portion of that tree; this
repository is kept public accordingly. **No code from Cal.com's Commercial License
directories (`packages/features/ee`, `apps/api/v2/src/ee`) is included** — functionality
needed from those areas is independently re-implemented. Details in
[`LICENSE-NOTES.md`](./LICENSE-NOTES.md).

## Development

Standard cal.diy setup applies: Node 20, Yarn 4 (corepack), Postgres, Redis.

```bash
yarn install
cp .env.example .env                       # + set secrets, DATABASE_URL (port 5450)
yarn workspace @calcom/prisma db-deploy
yarn workspace @calcom/prisma db-seed
yarn workspace @calcom/prisma rbp-setup    # pool teams + event types + webhooks
yarn workspace @calcom/api-v2 dev          # API on :5555
yarn workspace @calcom/web dev             # web on :3000
```

Copyright (c) 2020-present Cal.com, Inc.
