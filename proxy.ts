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
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;

  if (pathname === "/dashboard" || pathname === "/login") {
    const ok = await sessionOk(token);
    if (!ok) {
      // No usable session → the only page that helps is the login screen.
      // Carry the destination so signing in returns them where they were going.
      return pathname === "/login"
        ? undefined
        : Response.redirect(
            new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url),
          );
    }
    // Valid session → keep them on the dashboard, never on the login screen.
    return pathname === "/login"
      ? Response.redirect(new URL("/dashboard", request.url))
      : undefined;
  }

  if (pathname === "/" && (await sessionOk(token))) {
    return Response.redirect(new URL("/dashboard", request.url));
  }
}

export const config = {
  // Only the routes that actually redirect. `/portfolio` was listed but had no
  // logic behind it, so it just cost an extra Edge invocation per navigation.
  matcher: ["/", "/dashboard", "/login"],
};
