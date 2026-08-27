# Node 20 went EOL 2026-04-30 — no further security patches. 24 is the active LTS
# (EOL 2028-04-30). Staying on alpine/musl rather than moving to slim: sharp and the
# other prebuild-install deps resolved musl binaries when this tree was installed, and
# switching libc would re-resolve all of them for no security gain over -slim.
FROM node:24-alpine AS build

ARG DATABASE_DIRECT_URL
ARG DATABASE_URL

WORKDIR /calcom

# Historic workaround for Prisma's native query engine finding OpenSSL on musl.
# Very likely dead now — schema.prisma sets engineType = "client", so there is no
# native engine to link — but it is cheap to keep and expensive to be wrong about.
# -f, and tolerant of failure, so a base image that already provides the path (or
# moves it) cannot fail the build the way a bare `ln -s` would.
RUN ln -sf /usr/lib/libssl.so.3 /lib/libssl.so.3 || true

ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV DATABASE_DIRECT_URL=${DATABASE_DIRECT_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV USE_POOL="true"

COPY . .

RUN yarn install
RUN yarn workspace @calcom/api-v2 run generate-schemas
RUN yarn workspace @calcom/api-v2 run build:docker
RUN yarn workspace @calcom/api-v2 run build

EXPOSE 80

# Secrets Manager hydration — see scripts/hydrate-env.js for why this exists.
# Installed to /opt/hydrate, outside the repo's dependency graph, so it is
# deployment plumbing rather than an app dependency and cannot collide on an
# upstream merge.
#
# ENTRYPOINT, not a CMD wrapper: the deploy script runs `prisma migrate deploy`
# as a one-off task with a containerOverrides command, which replaces CMD but
# not entrypoint — migrations need the same hydrated env the service gets.
# package.json + package-lock.json come first so `npm ci` installs the EXACT
# graph committed in scripts/hydrate/, not whatever resolves on build day. This
# code reads credentials on every boot; its dependency set should be a fact in
# git, not a function of the clock.
COPY scripts/hydrate/package.json scripts/hydrate/package-lock.json /opt/hydrate/
RUN npm ci --prefix /opt/hydrate --omit=dev
COPY scripts/hydrate-env.js scripts/hydrate-env.sh /opt/hydrate/
RUN chmod +x /opt/hydrate/hydrate-env.sh

ENTRYPOINT ["/opt/hydrate/hydrate-env.sh"]
CMD [ "yarn", "workspace", "@calcom/api-v2", "start:prod"]
