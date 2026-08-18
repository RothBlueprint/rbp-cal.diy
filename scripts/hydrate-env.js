/**
 * Emit `export KEY='value'` lines for every key in this task's app-env secret
 * that is not already set. Consumed by scripts/hydrate-env.sh via eval.
 *
 * Why this exists: ECS `secrets` injection requires every key to be named in
 * the task definition, and on this stack the task definitions freeze their
 * container definition (cdktf owns rev 1; CI copies the live revision forward
 * and swaps only the image). So a key added to Secrets Manager — or to the
 * projection list in infra/cdktf/stacks/calendar.py — never reaches a running
 * container. DAILY_API_KEY sat in the secret through eleven deploys without
 * ever appearing in a task, and nothing reported it.
 *
 * The rbp Django app solved this the same way in core/settings/base.py
 * (_load_env_from_secrets_manager), after the identical bug left
 * GROWTHBOOK_CLIENT_KEY reading as None on beta. This is that, for Node, and
 * the semantics are deliberately identical:
 *
 *   - no-op off ECS, so local dev and image builds are untouched;
 *   - SETDEFAULT, never overwrite — anything the task definition still injects
 *     wins, so the projected keys remain the bootstrap floor;
 *   - best-effort: a Secrets Manager hiccup must not stop the app booting,
 *     because the projected keys are enough to serve.
 */
const REGION = process.env.AWS_REGION || "us-west-2";

/** Shell-safe single-quoted literal. Values can contain anything but NUL. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function taskFamily(metadataUri) {
  const res = await fetch(`${metadataUri}/task`, { signal: AbortSignal.timeout(2000) });
  return (await res.json()).Family || "";
}

async function main() {
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!metadataUri) return; // not on ECS — .env / shell env is the source

  // Required lazily, AFTER the off-ECS bail. At module scope it would throw on
  // any machine without the SDK installed — which is every dev machine, since
  // this lives in /opt/hydrate in the image and not in the repo's node_modules.
  // The entrypoint would survive that (it ignores a non-zero exit), but a
  // script whose no-op path crashes is one nobody can run to check what it does.
  const {
    SecretsManagerClient,
    GetSecretValueCommand,
  } = require("@aws-sdk/client-secrets-manager");

  // Explicit wins: the task definition sets APP_ENV_SECRET_ID in environment[],
  // so which secret a task reads is visible in the task definition rather than
  // inferred here. The derivation is the fallback for a task family that
  // predates it.
  let secretId = process.env.APP_ENV_SECRET_ID;
  if (!secretId) {
    const family = await taskFamily(metadataUri); // e.g. "rbp-cal-web"
    if (!/^rbp-cal-(web|api)$/.test(family)) return; // unknown family: leave it alone
    secretId = "rbp/calendar/app-env";
  }

  const client = new SecretsManagerClient({ region: REGION });
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  const out = [];
  for (const [key, value] of Object.entries(JSON.parse(SecretString))) {
    // setdefault. An empty string is a real value someone chose; only an
    // absent variable is hydrated.
    if (process.env[key] !== undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // not a shell-legal name
    out.push(`export ${key}=${shellQuote(value === null ? "" : value)}`);
  }
  if (out.length) process.stdout.write(`${out.join("\n")}\n`);
}

main().catch((err) => {
  // Fail OPEN, and say so on stderr where it lands in the task's CMK log group.
  // The projected keys still arrive via ECS, so the app boots either way; what
  // is lost is the keys only Secrets Manager knows about.
  process.stderr.write(`hydrate-env: skipped (${err && err.message}); using injected env only\n`);
});
