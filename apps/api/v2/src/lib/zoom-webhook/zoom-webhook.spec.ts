import {
  urlValidationResponse,
  verifyZoomSignature,
  ZOOM_SIGNATURE_MAX_AGE_SECONDS,
  zoomSignature,
  zoomUserIdFromToken,
} from "./zoom-webhook";

const SECRET = "zoom-secret-token";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ event: "app_deauthorized", payload: { user_id: "KdYKjnimT4KPd8FFgQt9FQ" } });

function token(claims: object) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS512", v: "2.0" })}.${part(claims)}.signature`;
}

describe("Zoom webhook signature", () => {
  it("accepts what Zoom would send", () => {
    const signature = zoomSignature(SECRET, String(NOW), BODY);

    expect(verifyZoomSignature(SECRET, String(NOW), Buffer.from(BODY), signature, NOW)).toBe(true);
  });

  // The endpoint is public and deletes credentials, so the signature is the
  // only thing between a stranger and every advisor's Zoom connection.
  it("rejects a body edited in flight", () => {
    const signature = zoomSignature(SECRET, String(NOW), BODY);
    const forged = BODY.replace("KdYKjnimT4KPd8FFgQt9FQ", "someone-else");

    expect(verifyZoomSignature(SECRET, String(NOW), forged, signature, NOW)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const signature = zoomSignature("not-our-secret", String(NOW), BODY);

    expect(verifyZoomSignature(SECRET, String(NOW), BODY, signature, NOW)).toBe(false);
  });

  it("rejects a replay outside the freshness window", () => {
    const old = String(NOW - ZOOM_SIGNATURE_MAX_AGE_SECONDS - 1);
    const signature = zoomSignature(SECRET, old, BODY);

    expect(verifyZoomSignature(SECRET, old, BODY, signature, NOW)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    const signature = zoomSignature("", String(NOW), BODY);

    expect(verifyZoomSignature("", String(NOW), BODY, signature, NOW)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyZoomSignature(SECRET, undefined, BODY, "v0=abc", NOW)).toBe(false);
    expect(verifyZoomSignature(SECRET, String(NOW), BODY, undefined, NOW)).toBe(false);
  });
});

describe("Zoom URL validation", () => {
  // Zoom checks encryptedToken against its own HMAC-SHA256 of plainToken, hex.
  it("answers the challenge with the HMAC of the plain token", () => {
    const response = urlValidationResponse(SECRET, "qgg8vlvZRS6UYooatFL8Aw");

    expect(response.plainToken).toBe("qgg8vlvZRS6UYooatFL8Aw");
    expect(response.encryptedToken).toMatch(/^[0-9a-f]{64}$/);
    expect(urlValidationResponse(SECRET, "qgg8vlvZRS6UYooatFL8Aw")).toEqual(response);
  });
});

describe("zoomUserIdFromToken", () => {
  it("reads the uid claim", () => {
    expect(zoomUserIdFromToken(token({ uid: "KdYKjnimT4KPd8FFgQt9FQ", aid: "acct" }))).toBe(
      "KdYKjnimT4KPd8FFgQt9FQ"
    );
  });

  it("returns null for anything that is not a token with a uid", () => {
    expect(zoomUserIdFromToken(undefined)).toBeNull();
    expect(zoomUserIdFromToken("not-a-jwt")).toBeNull();
    expect(zoomUserIdFromToken("a.%%%.c")).toBeNull();
    expect(zoomUserIdFromToken(token({ aid: "acct" }))).toBeNull();
  });
});
