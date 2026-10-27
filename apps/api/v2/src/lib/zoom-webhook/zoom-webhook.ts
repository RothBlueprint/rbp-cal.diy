import * as crypto from "node:crypto";

/**
 * Zoom's webhook signing, for the one Zoom event we take: app_deauthorized.
 *
 * Zoom signs every event POST with the app's "Secret Token" (Zoom App
 * Marketplace → the app → Features → Access): the `x-zm-signature` header is
 * `v0=` + HMAC-SHA256 of `v0:{x-zm-request-timestamp}:{raw body}`. The same
 * secret answers the `endpoint.url_validation` challenge Zoom sends when the
 * endpoint URL is saved, and again every 72 hours.
 *
 * https://developers.zoom.us/docs/api/webhooks/#verify-webhook-events
 */

// How old a signed timestamp may be. Zoom retries a failed delivery after 5 and
// 90 minutes with a fresh timestamp each time, so this only has to cover clock
// skew and transit, and it is what stops a captured request being replayed.
export const ZOOM_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export function zoomSignature(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const message = `v0:${timestamp}:${rawBody.toString()}`;
  return `v0=${crypto.createHmac("sha256", secret).update(message).digest("hex")}`;
}

export function verifyZoomSignature(
  secret: string,
  timestamp: string | undefined,
  rawBody: Buffer | string,
  signature: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!secret || !timestamp || !signature) return false;
  // Zoom sends seconds; tolerate milliseconds rather than reject a real event
  // over a unit change on their side.
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  const sentSeconds = sent > 1e12 ? Math.floor(sent / 1000) : sent;
  if (Math.abs(nowSeconds - sentSeconds) > ZOOM_SIGNATURE_MAX_AGE_SECONDS) return false;

  const expected = Buffer.from(zoomSignature(secret, timestamp, rawBody), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The body Zoom expects back from an `endpoint.url_validation` event. */
export function urlValidationResponse(secret: string, plainToken: string) {
  return {
    plainToken,
    encryptedToken: crypto.createHmac("sha256", secret).update(plainToken).digest("hex"),
  };
}

/**
 * The Zoom user a stored credential belongs to, read from its access token.
 *
 * The app_deauthorized event names the user by Zoom user id, and the
 * credential stores only the token response — no user id, and we hold no
 * scope that could look one up. Zoom's OAuth access tokens are JWTs whose
 * `uid` claim is that id, and it survives refreshes, so it is read from there.
 * Not verified: the token came from Zoom's token endpoint into our own
 * database, and this only decides which of OUR rows to delete.
 */
export function zoomUserIdFromToken(accessToken: unknown): string | null {
  if (typeof accessToken !== "string") return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims?.uid === "string" && claims.uid ? claims.uid : null;
  } catch {
    return null;
  }
}
