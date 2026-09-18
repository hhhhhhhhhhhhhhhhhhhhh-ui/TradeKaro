import type { NextRequest } from "next/server";

// ── Token check, done locally ───────────────────────────────────────────────
// Sessions are HS256 JWTs. The old middleware POSTed them to the backend on
// every navigation, which cost seconds per page. Everything below is pure CPU,
// so the redirect logic stays correct at zero network cost.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const b64 = s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(s.length / 4) * 4, "=");
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

type Claims = { sub?: string; exp?: number };

function claimsOf(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const bytes = b64urlToBytes(parts[1]);
  if (!bytes) return null;
  try {
    return JSON.parse(decoder.decode(bytes)) as Claims;
  } catch {
    return null;
  }
}

/**
 * Is this session usable?
 *
 * With AUTH_SECRET configured the signature is verified for real (HMAC via
 * WebCrypto — the same algorithm `issueToken` uses). Without it the token was
 * signed with the local secret file, which the Edge runtime cannot read, so we
 * fall back to checking the expiry claim only. Every API still verifies the
 * signature properly, so the fallback can only ever expose an empty shell.
 */
async function sessionOk(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const claims = claimsOf(token);
  if (!claims?.exp || claims.exp * 1000 < Date.now()) return false;

  const secret = process.env.AUTH_SECRET;
  if (!secret) return true;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sig = b64urlToBytes(parts[2]);
    if (!sig) return false;
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

// Next 16 replaced the `middleware` file convention with `proxy`.
// (Was middleware.ts — the warning asked for this migration.)
//
// This runs on the Edge before every matched navigation, so it must stay free
// of network calls. It used to POST /api/v1/auth/verifyToken to the backend on
// every hit, which measurably added 1–14s to each /dashboard + /login load and
// made the whole app feel slow. Token *validity* is checked client-side and by
// the APIs themselves (they answer 401); here we only need to know whether a
// session cookie is present.
//
// ── What is public ──────────────────────────────────────────────────────────
// The market pages (/stocks, /options, /screener, /topmovers) stay open on
// purpose: they are the shop window, they are crawlable, and none of them read
// account data. Everything below them needs a session.
//
// Without this the private pages rendered for anonymous visitors as a real-
// looking account full of zeros (₹0 portfolio, "Holdings · 0"), because each
// page is a client shell that just fires API calls and swallows the 401. The
// data was never exposed — the API always refused — but a visitor could not
// tell a locked page from an empty account.
//
// IMPORTANT: keep this list in step with `config.matcher`. A protected path
// missing from the matcher never reaches this function at all, so the smoke
// suite asserts that each of these redirects an anonymous request to /login.
const PROTECTED = [
  "/dashboard",
  "/portfolio",
  "/wallet",
  "/positions",
  "/ledger",
  "/watchlist",
  "/profile",
  "/settings",
  "/connect",
];

function isProtected(pathname: string) {
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Send a visitor to the login screen.
 *
 * `no-store` is load-bearing. A "you must sign in" bounce is a statement about
 * the session at one instant, and anything that replays it after the user has
 * signed in strands them on the login page with a valid cookie — the failure
 * looks exactly like the sign-in button doing nothing. Cloudflare sits in front
 * of this origin, so an uncacheable response is not a nicety.
 */
function toLogin(request: NextRequest, back: string) {
  // Built by hand rather than via Response.redirect(): that helper returns a
  // response with immutable headers, so adding Cache-Control to it throws and
  // every protected page answers 500.
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(
        `/login?next=${encodeURIComponent(back)}`,
        request.url,
      ).toString(),
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;
  const ok = await sessionOk(token);

  // The login screen is the one page a signed-in visitor should never sit on.
  if (pathname === "/login") {
    return ok
      ? Response.redirect(new URL("/dashboard", request.url))
      : undefined;
  }

  if (isProtected(pathname)) {
    if (ok) return undefined;
    // Carry the destination — query string included — so signing in returns
    // them to the exact page and filters they asked for.
    return toLogin(request, pathname + (request.nextUrl.search || ""));
  }

  // The landing page is public, but a signed-in visitor gets their dashboard.
  if (pathname === "/" && ok) {
    return Response.redirect(new URL("/dashboard", request.url));
  }
}

export const config = {
  // Only the routes that actually redirect, so public pages pay nothing.
  // `/admin` is deliberately absent: the console has its own cookie and its
  // own guards, and bouncing it to the trading login would lock operators out.
  matcher: [
    "/",
    "/login",
    "/dashboard",
    "/dashboard/:path*",
    "/portfolio",
    "/portfolio/:path*",
    "/wallet",
    "/wallet/:path*",
    "/positions",
    "/positions/:path*",
    "/ledger",
    "/ledger/:path*",
    "/watchlist",
    "/watchlist/:path*",
    "/profile",
    "/profile/:path*",
    "/settings",
    "/settings/:path*",
    "/connect",
    "/connect/:path*",
  ],
};
