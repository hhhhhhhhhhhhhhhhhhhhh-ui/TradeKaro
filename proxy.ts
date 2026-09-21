import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

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

// ── Partners ────────────────────────────────────────────────────────────────
//
// The affiliate panel is a SEPARATE identity system in the same app. It has its
// own cookie (`partner_token`), its own signing key and its own audience claim.
// That is what `partnerSessionOk` checks — not the trader cookie.
//
// KEEP PUBLIC: /partners, /partners/login, /partners/join and every /l/<slug>
// landing page. A landing page that requires a session cannot attract traffic,
// and a partner who has not signed in yet must still be able to apply.
const PARTNER_PROTECTED = [
  "/partners/dashboard",
  "/partners/links",
  "/partners/stats",
  "/partners/referrals",
  "/partners/earnings",
  "/partners/payouts",
  "/partners/profile",
  // Tracking holds a partner's own credentials. It is the one panel page where
  // a mistake means somebody else's ad account, so it must never be reachable
  // without a session.
  "/partners/tracking",
];

// Everything under /partners that is not in PARTNER_PROTECTED is public by
// default: the programme page, the sign-in screen, and the application form.
// Stated once here so a new public page does not have to be registered — only a
// new PROTECTED page does.

/**
 * Verify a partner token in the Edge.
 *
 * The signing key is DERIVED from AUTH_SECRET (HMAC of a fixed label), which is
 * the same derivation `partnerSecret()` uses on the server. A trader JWT pasted
 * into `partner_token` therefore fails here, and an affiliate JWT cannot open a
 * trader page either.
 */
async function partnerSessionOk(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const claims = claimsOf(token) as (Claims & { aud?: string }) | null;
  if (!claims?.exp || claims.exp * 1000 < Date.now()) return false;
  // Audience is checked before the signature: a trader token is rejected on the
  // claim alone, which is cheaper and states the intent in the code.
  if (claims.aud !== "partners") return false;

  const secret = process.env.AUTH_SECRET;
  // Same fallback as the trader session: without a configured secret we cannot
  // verify at the edge, so expiry is the only test here. Every API still
  // verifies the signature properly, so this can only ever expose an empty shell.
  if (!secret) return true;

  try {
    const base = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const derived = await crypto.subtle.sign(
      "HMAC",
      base,
      encoder.encode("tradestox:partners:v1"),
    );
    // The derived key must be the HEX STRING of that HMAC, because that is what
    // `partnerSecret()` on the server uses (`createHmac(...).digest("hex")`).
    // Importing the raw bytes instead produces a different key and rejects every
    // valid session — which is exactly the bug this comment exists to prevent.
    const hex = [...new Uint8Array(derived)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(hex),
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

function isPartnerProtected(pathname: string) {
  return PARTNER_PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Partner pages bounce to the partner login, never to /login. */
function toPartnerLogin(request: NextRequest, back: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(
        `/partners/login?next=${encodeURIComponent(back)}`,
        request.url,
      ).toString(),
      "Cache-Control": "no-store, must-revalidate",
    },
  });
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

  // ── Affiliate landing pages ─────────────────────────────────────────────
  //
  // /l/<slug>?ref=PT-XXXXXX drops the `ref` cookie here, on the edge, before the
  // page renders. The page also posts a click beacon, but that is JavaScript —
  // this makes attribution work even with scripting disabled, and makes the
  // cookie available to the signup request that may follow immediately.
  //
  // Nothing is validated at the edge (no database), so the cookie is treated as
  // a hint only. `attributeSignup` on the server is what actually decides.
  if (pathname.startsWith("/l/")) {
    const ref = request.nextUrl.searchParams.get("ref");
    if (!ref) return undefined;

    // A PREVIEW MUST NOT COOKIE. `/api/track/click` already refuses to set this
    // on a preview, and for a while this edge path did not — so the protection
    // was only half there. The visitor on a preview URL is the partner checking
    // their own link, and dropping `ref` here left them carrying their own
    // referral cookie around for 90 days, which is both a self-attribution risk
    // and simply a lie about who sent them.
    //
    // The flag is read the same permissive way the page reads it, so the edge
    // and the page can never disagree about whether this is a preview.
    const preview = ["1", "true"].includes(
      request.nextUrl.searchParams.get("preview") || "",
    );
    if (preview) return undefined;

    const res = NextResponse.next();
    res.cookies.set("ref", ref.slice(0, 32), {
      path: "/",
      maxAge: 90 * 86400,
      sameSite: "lax",
    });
    const c = request.nextUrl.searchParams.get("c");
    if (c)
      res.cookies.set("ref_c", c.slice(0, 80), {
        path: "/",
        maxAge: 90 * 86400,
        sameSite: "lax",
      });
    return res;
  }

  // ── Partner surface (checked first: it has its own cookie and its own key) ──
  if (pathname.startsWith("/partners")) {
    const partnerOk = await partnerSessionOk(
      request.cookies.get("partner_token")?.value,
    );
    // Only the programme landing page forwards a signed-in partner onward.
    //
    // /partners/login MUST NOT, and this is not a style choice. A token can
    // verify here and still be worthless — the affiliate may have been deleted
    // or suspended since it was issued, and the Edge cannot read the database to
    // find out. Redirecting from /partners/login on the cookie alone therefore
    // produced a genuine infinite loop:
    //
    //   /partners/login -> (cookie verifies) -> /partners/dashboard
    //   /partners/dashboard -> API 401 -> /partners/login -> ...
    //
    // The login screen now decides for itself by asking the API, which can check
    // the database. Here we only need to know the cookie is present.
    const isProgrammePage =
      pathname === "/partners" || pathname === "/partners/";
    if (isProgrammePage && partnerOk) {
      return Response.redirect(new URL("/partners/dashboard", request.url));
    }
    if (isPartnerProtected(pathname)) {
      if (partnerOk) return undefined;
      return toPartnerLogin(request, pathname + (request.nextUrl.search || ""));
    }
    return undefined;
  }

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
    // Partner panel. The public partner pages (/partners, /partners/login,
    // /partners/join) are matched too — they must redirect a signed-in partner
    // to the dashboard, which only the proxy can decide. `/l/:path*` stays out
    // on purpose: landing pages are open to the world and pay nothing here.
    "/partners",
    "/partners/:path*",
    // Affiliate landing pages. Matched ONLY to set the attribution cookie — the
    // page itself is public and the proxy lets every one of them through.
    "/l/:path*",
  ],
};
