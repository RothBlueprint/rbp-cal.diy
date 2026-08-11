#!/usr/bin/env bash
# Deploy cal-web + cal-api to ECS, following the rbp ecs-deploy.sh contract:
#   1. Register both task definitions digest-pinned (Fargate's tag->digest
#      cache makes mutable-tag deploys unreliable).
#   2. Run `prisma migrate deploy` as a one-off task with the NEW api image.
#      Non-zero exit aborts the deploy - the old services keep serving.
#   3. update-service both services, wait stable.
#
# Required env:
#   AWS_REGION        e.g. us-west-2
#   CLUSTER           ECS cluster name (rbp-fargate)
#   WEB_IMAGE         ghcr.io/...:tag   (human-readable logging)
#   WEB_DIGEST        sha256:... of the web image
#   API_IMAGE         ghcr.io/...:tag
#   API_DIGEST        sha256:...
#   MIGRATE_SUBNETS   comma-separated private subnet ids
#   MIGRATE_SG        cal tasks security group id
#
# Families/services are fixed: rbp-cal-web/cal-web, rbp-cal-api/cal-api.
# Idempotent; safe to re-run after partial failure.

set -euo pipefail

: "${AWS_REGION:?}" "${CLUSTER:?}"
: "${WEB_IMAGE:?}" "${WEB_DIGEST:?}" "${API_IMAGE:?}" "${API_DIGEST:?}"
: "${MIGRATE_SUBNETS:?}" "${MIGRATE_SG:?}"

FAMILY_WEB=rbp-cal-web
FAMILY_API=rbp-cal-api
SERVICE_WEB=cal-web
SERVICE_API=cal-api

pin() { echo "${1%:*}@${2}"; }
WEB_PINNED=$(pin "$WEB_IMAGE" "$WEB_DIGEST")
API_PINNED=$(pin "$API_IMAGE" "$API_DIGEST")
echo "==> web: $WEB_IMAGE -> $WEB_PINNED"
echo "==> api: $API_IMAGE -> $API_PINNED"

# Same jq pipeline as rbp's lib-td.sh: strip server-managed fields, swap image.
register_pinned() { # family pinned_image -> new task def ARN
  local family=$1 image=$2 tmp
  tmp=$(mktemp -t cal-td.XXXXXX.json)
  aws ecs describe-task-definition --task-definition "$family" --region "$AWS_REGION" \
    | jq --arg img "$image" '
        .taskDefinition
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
              .compatibilities, .registeredAt, .registeredBy)
        | .containerDefinitions[0].image = $img
      ' > "$tmp"
  aws ecs register-task-definition --region "$AWS_REGION" \
    --cli-input-json "file://$tmp" | jq -r '.taskDefinition.taskDefinitionArn'
  rm -f "$tmp"
}

echo "==> Registering task definitions"
NEW_API_ARN=$(register_pinned "$FAMILY_API" "$API_PINNED")
echo "    api -> $NEW_API_ARN"
NEW_WEB_ARN=$(register_pinned "$FAMILY_WEB" "$WEB_PINNED")
echo "    web -> $NEW_WEB_ARN"

SUBNETS_JSON=$(echo "$MIGRATE_SUBNETS" | jq -R 'split(",") | map(gsub("^\\s+|\\s+$"; ""))')
NETWORK_CONFIG=$(jq -n --argjson subnets "$SUBNETS_JSON" --arg sg "$MIGRATE_SG" '{
  awsvpcConfiguration: {subnets: $subnets, securityGroups: [$sg], assignPublicIp: "DISABLED"}
}')
# Private subnets + NAT: image pull and Neon reach both work without a public IP.
OVERRIDES=$(jq -n '{containerOverrides: [{
  name: "app",
  command: ["sh", "-c", "yarn workspace @calcom/prisma db-deploy"]
}]}')

echo "==> Running prisma migrate deploy one-off against $NEW_API_ARN"
MIGRATE_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" --region "$AWS_REGION" \
  --task-definition "$NEW_API_ARN" \
  --launch-type FARGATE --platform-version LATEST \
  --network-configuration "$NETWORK_CONFIG" \
  --overrides "$OVERRIDES" \
  --started-by "gh-actions-cal-deploy" \
  | jq -r '.tasks[0].taskArn')
echo "    -> $MIGRATE_ARN"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --region "$AWS_REGION" --tasks "$MIGRATE_ARN"

DESC=$(aws ecs describe-tasks --cluster "$CLUSTER" --region "$AWS_REGION" --tasks "$MIGRATE_ARN")
EXIT=$(echo "$DESC" | jq -r '.tasks[0].containers[0].exitCode // "null"')
REASON=$(echo "$DESC" | jq -r '.tasks[0].stoppedReason // "-"')
echo "    exitCode=$EXIT reason=$REASON"
if [[ "$EXIT" != "0" ]]; then
  echo "::error::Migration exited $EXIT - aborting. Logs: /ecs/rbp/cal-api"
  exit 1
fi

echo "==> Updating services"
for pair in "$SERVICE_API:$NEW_API_ARN" "$SERVICE_WEB:$NEW_WEB_ARN"; do
  svc="${pair%%:*}"; arn="${pair#*:}"
  aws ecs update-service --cluster "$CLUSTER" --region "$AWS_REGION" \
    --service "$svc" --task-definition "$arn" --force-new-deployment > /dev/null
  echo "    $svc -> $arn"
done

echo "==> Waiting for services to stabilize"
aws ecs wait services-stable --cluster "$CLUSTER" --region "$AWS_REGION" \
  --services "$SERVICE_API" "$SERVICE_WEB"
echo "==> Done."
