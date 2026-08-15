import { looksSigned, SIGNED_STATE_TTL_SECONDS, signState, verifyState } from "./signed-state";

const SECRET = "test-nextauth-secret";
const OTHER_SECRET = "a-different-secret";

describe("signed OAuth state", () => {
  it("round-trips the user it was issued for", () => {
    const state = signState({ userId: 42, returnTo: "https://rbp.test/calendar" }, SECRET);

    expect(verifyState(state, SECRET)?.userId).toBe(42);
    expect(verifyState(state, SECRET)?.returnTo).toBe("https://rbp.test/calendar");
  });

  // The whole point: the callback is unguarded, so a state that anyone can author
  // is an account takeover of the named user's calendar.
  it("rejects a payload edited in flight", () => {
    const state = signState({ userId: 42 }, SECRET);
    const [version, body, signature] = state.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ userId: 1, exp: 9999999999 }), "utf8").toString(
      "base64url"
    );

    expect(verifyState(`${version}.${forgedBody}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a signature from a different secret", () => {
    const state = signState({ userId: 42 }, OTHER_SECRET);

    expect(verifyState(state, SECRET)).toBeNull();
  });

  it("rejects an expired state", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const state = signState({ userId: 42 }, SECRET, issued);
    const tooLate = new Date(issued.getTime() + (SIGNED_STATE_TTL_SECONDS + 1) * 1000);

    expect(verifyState(state, SECRET, tooLate)).toBeNull();
    expect(verifyState(state, SECRET, issued)).not.toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    for (const bad of ["", "not-a-state", "v1.only-two", "v1..", "v2.a.b", null, undefined]) {
      expect(verifyState(bad as string, SECRET)).toBeNull();
    }
  });

  // A signature of the wrong LENGTH must fail the same way as a wrong one —
  // timingSafeEqual throws on mismatched lengths if that isn't handled.
  it("rejects a truncated signature without throwing", () => {
    const state = signState({ userId: 42 }, SECRET);
    const [version, body, signature] = state.split(".");

    expect(() => verifyState(`${version}.${body}.${signature.slice(0, 8)}`, SECRET)).not.toThrow();
    expect(verifyState(`${version}.${body}.${signature.slice(0, 8)}`, SECRET)).toBeNull();
  });

  it("refuses to sign without a secret", () => {
    expect(() => signState({ userId: 42 }, "")).toThrow();
  });

  // looksSigned decides reject-vs-fall-through in the callbacks. If a forged
  // signed state didn't "look signed", it would be handed to the legacy JSON
  // parser instead of being refused.
  it("recognises its own shape without vouching for it", () => {
    expect(looksSigned(signState({ userId: 42 }, SECRET))).toBe(true);
    expect(looksSigned('{"accessToken":"legacy"}')).toBe(false);
    expect(looksSigned(undefined)).toBe(false);

    const forged = `${signState({ userId: 42 }, OTHER_SECRET)}`;
    expect(looksSigned(forged)).toBe(true);
    expect(verifyState(forged, SECRET)).toBeNull();
  });
});
