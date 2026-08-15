import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tamper-proof OAuth `state` for admin-driven ("headless") app connections.
 *
 * ## Why this exists
 *
 * Cal's OAuth connect flows (conferencing apps, Google/Outlook calendars) carry
 * the identity of the connecting user *inside the `state` query param*, and the
 * provider callbacks resolve the credential owner by looking that value up:
 *
 *   const ownerId = await tokensRepository.getAccessTokenOwnerId(state.accessToken)
 *
 * That works because `accessToken` is a bearer SECRET — possessing it is proof of
 * being that user. It also means only a caller who already holds the target
 * user's access token can start the flow, so a provisioning system driving the
 * connect on a user's behalf (with an admin key) cannot: the admin key is not in
 * the accessToken table, and substituting it would file the credential under the
 * admin instead.
 *
 * Signing the state removes that constraint without removing the property that
 * made it safe. An admin-scoped endpoint states "this flow belongs to user N" and
 * signs it; the callback verifies the signature before trusting the claim.
 *
 * ## Why it must be signed rather than plain
 *
 * The provider callbacks are deliberately UNGUARDED — they have to be, because
 * the provider redirects a browser to them with no credentials of ours attached.
 * `state` makes a full round trip through the provider and comes back as
 * attacker-influencable input. A plain `{"userId": 42}` would therefore let
 * anyone who can craft a callback URL bind THEIR provider account to ANY user —
 * a full account-takeover of that user's calendar. The HMAC is the only thing
 * standing in for the guard the callback cannot have.
 *
 * ## Properties
 *
 * - HMAC-SHA256 over the exact serialized payload, keyed by NEXTAUTH_SECRET.
 * - Constant-time comparison, so the signature can't be recovered by timing.
 * - Short TTL: a state is a single in-flight authorization, not a session.
 * - Verify returns null on every failure mode (malformed, bad signature,
 *   expired) rather than throwing per-reason, so callers can't leak which.
 */

/** How long a signed state stays valid. Long enough for a human to sit on a
 * provider consent screen, short enough that a leaked URL is not a standing
 * credential. */
export const SIGNED_STATE_TTL_SECONDS = 15 * 60;

export const SIGNED_STATE_VERSION = "v1";

export type SignedStatePayload = {
  /** The user the resulting credential must be attached to. */
  userId: number;
  /** Where to send the browser after the provider returns. */
  returnTo?: string;
  onErrorReturnTo?: string;
  /** Epoch seconds after which this state is refused. */
  exp: number;
};

type SignedStateInput = Omit<SignedStatePayload, "exp"> & { exp?: number };

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Serialize + sign a state. Returns `v1.<payload>.<signature>`.
 *
 * The signature covers the encoded payload string rather than the object, so
 * verification never has to re-serialize (and can't be broken by a key-ordering
 * difference between the two sides).
 */
export function signState(payload: SignedStateInput, secret: string, now = new Date()): string {
  if (!secret) {
    // Failing loudly beats emitting an unsigned state that the callback would
    // then refuse in a way that looks like a provider error.
    throw new Error("signState: missing signing secret");
  }
  const withExpiry: SignedStatePayload = {
    ...payload,
    exp: payload.exp ?? Math.floor(now.getTime() / 1000) + SIGNED_STATE_TTL_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(withExpiry));
  return `${SIGNED_STATE_VERSION}.${body}.${sign(body, secret)}`;
}

/**
 * Verify and decode a state. Returns null unless it is well-formed, correctly
 * signed and unexpired.
 *
 * Returns null (rather than throwing) for a state that simply isn't ours —
 * callers fall back to the legacy `accessToken` path on null, which is what
 * keeps the platform/managed-user flows working unchanged.
 */
export function verifyState(
  raw: string | undefined | null,
  secret: string,
  now = new Date()
): SignedStatePayload | null {
  if (!raw || !secret) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [version, body, signature] = parts;
  if (version !== SIGNED_STATE_VERSION) return null;

  const expected = sign(body, secret);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself an oracle if
  // allowed to escape as a distinct outcome — check length first, same answer.
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  let payload: SignedStatePayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as SignedStatePayload;
  } catch {
    return null;
  }

  if (typeof payload?.userId !== "number" || !Number.isInteger(payload.userId)) return null;
  if (typeof payload?.exp !== "number") return null;
  if (payload.exp * 1000 <= now.getTime()) return null;

  return payload;
}

/**
 * True when `raw` looks like one of ours.
 *
 * Only a shape check — it does NOT verify the signature, and must never be used
 * to decide whether to trust a state. Its one job is letting a callback tell
 * "this is a signed state that failed verification" (reject) apart from "this is
 * a legacy JSON state" (fall through to the accessToken path), so a forged
 * signature can't be downgraded into the legacy branch.
 */
export function looksSigned(raw: string | undefined | null): boolean {
  return typeof raw === "string" && raw.startsWith(`${SIGNED_STATE_VERSION}.`);
}
