import process from "node:process";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { defaultCookies } from "@calcom/lib/default-cookies";
import { prisma } from "@calcom/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

// Consumes a single-use SSO token minted by POST /v2/users/:id/login-token and
// signs the browser in as that user, then redirects to `next` (a same-origin
// relative path). This is the transparent-onboarding entry point: rbp mints a
// token and redirects the agent here with next pointing at the calendar-connect
// flow (or anywhere in the app for one-click sign-in).
//
// Trust: the minted token IS the boundary (admin-key gated, single-use, ~60s).
// This route only consumes it; it grants no access on its own.

const SSO_TOKEN_IDENTIFIER_PREFIX = "rbp-sso:";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function safeNext(next: string | null): string {
  // Same-origin relative paths only — no protocol-relative (`//host`) or absolute
  // URLs, which would make this an open redirect.
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  if (!token) {
    return NextResponse.json({ message: "token is required" }, { status: 400 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ message: "server misconfigured" }, { status: 500 });
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  // Always consume the row if it exists (single-use), even when expired.
  if (record) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => undefined);
  }

  // One guard rather than a separate isValid flag: narrowing `record` to
  // non-null has to survive to the read below, and TypeScript only carries
  // that through a direct condition, not one wrapped in Boolean(...).
  if (
    !record ||
    !record.identifier.startsWith(SSO_TOKEN_IDENTIFIER_PREFIX) ||
    record.expires <= new Date()
  ) {
    return NextResponse.json({ message: "invalid or expired token" }, { status: 401 });
  }

  const userId = Number(record.identifier.slice(SSO_TOKEN_IDENTIFIER_PREFIX.length));
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, username: true, locked: true },
  });

  if (!user || user.locked) {
    return NextResponse.json({ message: "user not available" }, { status: 401 });
  }

  // A minimal token; the next-auth jwt callback re-hydrates the rest (role,
  // profile, etc.) from the DB by sub/email on the first authenticated request.
  const sessionToken = await encode({
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: String(user.id),
      id: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
    },
  });

  const cookieConfig = defaultCookies(WEBAPP_URL?.startsWith("https://")).sessionToken;
  const response = NextResponse.redirect(new URL(next, WEBAPP_URL));
  response.cookies.set(cookieConfig.name, sessionToken, {
    ...cookieConfig.options,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
