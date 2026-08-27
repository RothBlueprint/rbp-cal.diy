# Operator setup — what's needed on your side

Everything I can't do from code: AWS console, Neon, OAuth app registrations, GitHub
settings, and the go-live gate. Ordered so each section unblocks the next. This file is
a working checklist — delete or move it once go-live is done.

Legend: 🔴 blocks deploy · 🟠 blocks real agents · 🟢 hardening / nice-to-have.

---

## A. Deploy the stack (Django repo + AWS)

The `CalendarStack` is merged and deployed (rbp PR #929): two Fargate services
behind the shared ALB, a dedicated Neon database and an ElastiCache Serverless Valkey.

2. 🔴 **Create a Neon database** for cal (its own database, or a fresh Neon project).
   Grab two connection strings: the **pooler** host → `DATABASE_URL`, and the **direct**
   (non-pooler) host → `DATABASE_DIRECT_URL`. Neon is pg17, well above cal's floor.
3. 🔴 **`cdktf deploy calendar`** (operator). Creates: cal-web + cal-api services, the
   Valkey cache, the `rbp/calendar/app-env` secret *shell*, and the
   `rbp-calendar-deploy` OIDC role. Note the stack outputs — you need `deploy_role_arn`.
   - First apply will show the services unhealthy until images + secrets exist; that's
     expected (greenfield bring-up). The images already exist in GHCR.

## B. Secrets & OAuth apps (AWS console + Google/Microsoft)

4. 🔴 **Seed `rbp/calendar/app-env`** (AWS Secrets Manager console — never a `.env` sync).
   JSON blob with these keys (the task defs project them per-key):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooler URL |
   | `DATABASE_DIRECT_URL` | Neon direct URL |
   | `DATABASE_READ_URL` / `DATABASE_WRITE_URL` | = `DATABASE_URL` (no read replica) |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` — **same value used by web and api** |
   | `CALENDSO_ENCRYPTION_KEY` | `openssl rand -base64 24` (32 chars, AES-256) |
   | `JWT_SECRET` | `openssl rand -base64 32` |
   | `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` | any dummy string (billing unused) |
   | `CRON_API_KEY` | `openssl rand -hex 24` (used by the cron driver, section D) |

5. 🟠 **Google Calendar OAuth app** — a Google Cloud OAuth client with Calendar + Meet
   scopes, redirect `https://calendar.rothblueprint.com/api/integrations/googlecalendar/callback`.
   Seed its keys into cal's app-store (`seed-app-store` reads `GOOGLE_API_CREDENTIALS`, or
   an admin saves them at `/settings/admin/apps`). Without this the Google Connect button 500s.
6. 🟠 **Microsoft/Azure Calendar OAuth app** (your Outlook majority) — an Azure app
   registration with `Calendars.ReadWrite` + `offline_access`, redirect
   `.../api/integrations/office365calendar/callback`. Seed its client id/secret into the
   `office365-calendar` app keys the same way. **This is the only Microsoft-side setup the
   whole system needs** — agents authenticate to cal via the SSO token, never "sign in with
   Microsoft"; this app only authorizes calendar access.
7. 🟠 **SMTP** — `EMAIL_SERVER_HOST/PORT/USER/PASSWORD` or `RESEND_API_KEY` in the secret,
   for booking confirmations (verification/password-reset are bypassed for provisioned
   agents, but confirmations to leads matter).

## C. Arm CI deploy (GitHub repo settings)

8. 🔴 Set repo **Variables** on `RothBlueprint/rbp-cal.diy` (Settings → Secrets and
   variables → Actions → Variables) to activate the deploy job:
   - `DEPLOY_ENABLED` = `true`
   - `AWS_DEPLOY_ROLE_ARN` = the `deploy_role_arn` stack output from step 3
   - `MIGRATE_SUBNETS` = the private subnet ids (comma-separated)
   - `MIGRATE_SG` = the cal tasks SG id
9. 🟢 **Verify the GHCR pull PAT** (`rbp/shared/ghcr-pull`) can read
   `ghcr.io/rothblueprint/rbp-cal-*`. Since the repo is org-owned now it likely already
   can; re-seed via `infra/scripts/seed-ghcr-pull.sh` if a pull fails.
10. 🟢 On the repo, **disable Issues and PRs** (Settings → General → Features) to match the
    "not accepting contributions" README.

## D. First-boot + go-live

11. 🔴 After the first successful deploy, **provision the pools**: run
    `yarn workspace @calcom/prisma rbp-setup` against the prod DB with
    `RBP_POOL_COUNT`, `RBP_WEBHOOK_URL` (rbp's receiver), `RBP_WEBHOOK_SECRET` set. This
    creates the team(s), round-robin event type(s), and booking webhooks. It also sweeps
    every agent's personal `intro` event type and gives it the same event-type-scoped
    webhook, so re-running it repairs drift. Steady state, per-agent webhooks are created
    by rbp at activation through `POST /v2/users/{userId}/webhooks`.
    **On the first prod run also set `RBP_ADOPT_USER_SCOPED_WEBHOOKS=1`** — user 1 has a
    legacy user-scoped webhook that double-delivers every pool booking he hosts. The flag
    converts it to event-type scope, or deactivates it if that event type already has its
    own webhook; either way the row survives, so both are reversible. Without the flag
    nothing is changed and the case is reported instead. Not needed on later runs.
12. 🔴 **Mint the production admin API key** for rbp: log into
    `calendar.rothblueprint.com` as an admin user and create an API key in settings (the
    v2 `/api-keys/refresh` endpoint is stubbed in this fork), or insert one directly. Store
    it in Django's secrets. This is what rbp uses for every `/v2/...` call.
13. 🟠 Set `NEXT_PUBLIC_DISABLE_SIGNUP=true` in the secret — the public signup route is
    unauthenticated and its rate limiter is a no-op without `UNKEY_ROOT_KEY`.
14. 🟠 **Cron driver decision** — cal's scheduled work (webhook retries, reminders) needs a
    driver. Either an EventBridge Scheduler → RunTask hitting `/api/cron/*` with
    `CRON_API_KEY`, or accept none for launch (booking webhooks fire inline regardless;
    only *retries* need the tasker). Tell me which and I'll wire it.
15. 🟠 **The go-live gate: re-run the load probe with real connected calendars.** The local
    probe measured the compute floor (slots ~17ms, booking ~1s at 200 hosts) with *zero*
    connected calendars. Connect real Google/Outlook calendars to a subset of agents and
    re-run `/home/omega/cal-probe/probe.sh` — this is the one performance unknown, and it
    decides single-pool vs. the 5×40 shard. Enable `calendar-cache-sql` before this.
16. 🟢 Update the runbook listener-priority table (add 500/510) and run the SOC2 invariant
    sweep, per your infra conventions.

## E. rbp Django app (I'm building the client; you supply)

17. The **admin API key** from step 12 → Django settings/secrets.
18. The **webhook receiver** endpoint reachable from cal, with the HMAC secret matching
    `RBP_WEBHOOK_SECRET` from step 11.
19. The **pool count** decided by step 15's probe → the client's pool-selection config.

---

### Minimum path to a working demo (no real agents)

A → B(4) → C(8) → deploy → D(11,12). That gets `calendar.rothblueprint.com` serving with
the API driveable by rbp. The OAuth apps (B 5–6) and the load probe (D 15) are only needed
before onboarding real agents who connect calendars.
