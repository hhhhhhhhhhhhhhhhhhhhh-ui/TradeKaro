import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { authSecret } from "./authStore";
import { db } from "./db";

// ── Partner sessions ────────────────────────────────────────────────────────
//
// Affiliates are a SEPARATE identity store from traders, and this file is what
// keeps them separate. Two independent guarantees, because either one alone is
// easy to break later:
//
//   1. A different cookie. Traders use `token`; partners use `partner_token`.
//      `partnerTokenFromRequest` only ever looks at `partner_token`, so a trader
//      who is logged in is still a stranger on /partners.
//
//   2. A different signing key AND an audience claim. The key is derived from
//      the trader secret but is not equal to it, so a trader JWT fails the
//      signature check here even if someone copies it into `partner_token`.
//      `aud: "partners"` is then checked as a second, explicit gate.
//
// The reason this matters: a partner panel shows the identity of customers and
// the money they generated. "Logged into the app" must never be enough to reach
// it, in either direction.

/** Cookie holding an affiliate session. Distinct from the trader `token`. */
export const PARTNER_COOKIE = "partner_token";

/** Audience claim stamped into every partner token. */
const AUD = "partners";

let secretCache: string | null = null;

/**
 * Signing key for affiliate sessions.
 *
 * Derived (not concatenated) from the trader secret so the two keys cannot be
 * confused by a prefix/suffix accident, and so rotating AUTH_SECRET rotates
 * both — no second env var to forget.
 */
export async function partnerSecret(): Promise<string> {
  if (secretCache) return secretCache;
  const base = await authSecret();
  secretCache = createHmac("sha256", base)
    .update("tradestox:partners:v1")
    .digest("hex");
  return secretCache;
}

export function hashPartnerPassword(clientHash: string, salt: string) {
  return scryptSync(clientHash, salt, 64).toString("hex");
}

export function newSalt() {
  return randomBytes(16).toString("hex");
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export type PartnerClaims = {
  id: string;
  code: string;
  email: string;
};

export async function issuePartnerToken(
  p: { id: string; code: string; email: string },
  days = 30,
): Promise<string> {
  const secret = await partnerSecret();
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: p.id,
      aud: AUD,
      code: p.code,
      email: p.email,
      iat,
      exp: iat + days * 86400,
    }),
  );
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * Verify a partner session.
 *
 * Returns null for a trader token pasted in here — the signature will not match
 * — and null for an affiliate token pasted into a trader route, because the
 * trader verifier uses a different key.
 */
export async function verifyPartnerToken(
  token: string | undefined,
): Promise<PartnerClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const secret = await partnerSecret();
  const expect = createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  const a = Buffer.from(expect);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (payload?.aud !== AUD) return null;
    if (!payload?.sub || !payload?.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return {
      id: String(payload.sub),
      code: String(payload.code || ""),
      email: String(payload.email || ""),
    };
  } catch {
    return null;
  }
}

/**
 * Read the partner session off a request.
 *
 * Deliberately does NOT fall back to the trader `token` cookie — that fallback
 * is the exact mistake that would let a customer open the partner panel.
 */
export async function partnerTokenFromRequest(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  const cookie = req.headers.get("cookie") || "";
  const m = /(?:^|;\s*)partner_token=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Claims for a token that still belongs to a live, approved affiliate. */
export async function livePartner(
  token: string | undefined,
): Promise<PartnerClaims | null> {
  const claims = await verifyPartnerToken(token);
  if (!claims) return null;
  const row = db
    .prepare(`SELECT status FROM affiliates WHERE id = ?`)
    .get(claims.id) as { status?: string } | undefined;
  if (!row) return null;
  // A suspended affiliate keeps a valid signature but loses access immediately,
  // without having to invalidate every token they were ever issued.
  if (String(row.status) !== "approved") return null;
  return claims;
}

/** Is there any affiliate row at all for this id (any status)? */
export function affiliateExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM affiliates WHERE id = ?`)
    .get(id) as { ok?: number } | undefined;
  return !!row;
}
