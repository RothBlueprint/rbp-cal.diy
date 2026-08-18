#!/bin/sh
# Container ENTRYPOINT: hydrate env from Secrets Manager, then exec the command.
#
# ENTRYPOINT and not a wrapper inside CMD, deliberately. The deploy script runs
# migrations as a one-off ECS task with a containerOverrides `command`, which
# replaces CMD but NOT entrypoint — so migrations get the same hydrated
# environment as the service. Wrapping CMD instead would leave `prisma migrate
# deploy` running with only the projected keys.
#
# `exec` at the end so the app is PID 1: ECS sends SIGTERM to PID 1 on a rolling
# deploy, and a shell parent would swallow it and turn a graceful drain into a
# 30-second kill.
#
# Fails open. If the node helper errors, $(...) is empty, eval does nothing, and
# the app starts on the keys ECS injected — which are enough to serve.
set -e

if [ -n "$ECS_CONTAINER_METADATA_URI_V4" ]; then
  eval "$(node /opt/hydrate/hydrate-env.js || true)"
fi

exec "$@"
