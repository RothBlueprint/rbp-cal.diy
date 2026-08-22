#!/bin/sh
set -x

# Replace the statically built BUILT_NEXT_PUBLIC_WEBAPP_URL with run-time NEXT_PUBLIC_WEBAPP_URL
# NOTE: if these values are the same, this will be skipped.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"

scripts/wait-for-it.sh ${DATABASE_HOST} -- echo "database is up"
npx prisma migrate deploy --schema /calcom/packages/prisma/schema.prisma
npx ts-node --transpile-only /calcom/scripts/seed-app-store.ts
# Node's default server.keepAliveTimeout is 5s, well under the rbp-public ALB's 120s
# idle_timeout: the ALB reuses a pooled connection just as the target sends FIN and
# returns 502 (target_status_code="-"). Keep-alive must OUTLIVE the ALB's idle window.
# `next start` only reads this from the CLI flag (ms) -- KEEP_ALIVE_TIMEOUT in the env
# is read solely by the standalone server.js, which this image does not execute.
yarn start -- --keepAliveTimeout "${KEEP_ALIVE_TIMEOUT:-125000}"
