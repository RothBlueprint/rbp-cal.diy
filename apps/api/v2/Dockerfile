FROM node:20-alpine AS build

ARG DATABASE_DIRECT_URL
ARG DATABASE_URL

WORKDIR /calcom

RUN set -eux;
RUN ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3

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
