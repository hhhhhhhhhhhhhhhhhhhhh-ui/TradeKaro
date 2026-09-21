// Per-partner tracking pixels.
//
// WHY A PARTNER WANTS THIS
//
// A partner runs their own ads with their own budget. Without their own pixel on
// our pages they can see clicks but never learn which of their ad sets produced
// a signup or a deposit — so they cannot optimise, and they stop spending. This
// is the single most-requested thing in any affiliate programme.
//
// THE RULE THAT MAKES IT SAFE
//
// A PARTNER'S PIXEL ID IS INTERPOLATED INTO A SCRIPT TAG ON OUR DOMAIN. A pixel
// id is attacker-controlled input: a partner, or anyone who gets a partner
// account, could try to close a string and run arbitrary JavaScript for every
// visitor who arrives through their link — on our origin, with our cookies.
//
// So an id is not "sanitised", it is VALIDATED AGAINST A STRICT SHAPE, and
// anything that does not match exactly is rejected. There is no escaping helper
// here and there should never be one: an escaped id is still an id we chose to
// trust, and the safest parse of a numeric pixel id is a regex that only accepts
// digits.
//
// The access token is never rendered anywhere — it is only ever read on the
// server, at send time, to call the provider. Tokens are encrypted at rest; see
// pixelCrypto.ts.

import { randomBytes } from "crypto";
import { db } from "./db";
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  secretHint,
} from "./pixelCrypto";

export type AffiliateProvider = "meta" | "ga4";

/** What a partner's pixel config looks like from the outside. Never a token. */
export type PartnerPixel = {
  provider: AffiliateProvider;
  pixelId: string;
  label: string;
  enabled: boolean;
  /** Whether a credential is on file, and a hint to recognise it. */
  hasToken: boolean;
  tokenHint: string | null;
  updatedAt: number;
};

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Meta pixel ids are numeric, and that is the whole of the security model: a
 * string of digits cannot close a quote, cannot open a tag, and cannot become
 * part of an expression. Loosening this to "alphanumeric" would hand a partner
 * a scripting primitive on our origin.
 */
export function validateMetaPixelId(raw: unknown): ValidationResult {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Enter your Meta pixel ID" };
  if (!/^\d{10,20}$/.test(v))
    return {
      ok: false,
      error:
        "A Meta pixel ID is 10 to 20 digits, nothing else. Find it in Events Manager.",
    };
  return { ok: true, value: v };
}

/** GA4 measurement ids look like `G-XXXXXXXX`. Same reasoning, tighter shape. */
export function validateGa4MeasurementId(raw: unknown): ValidationResult {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!v) return { ok: false, error: "Enter your GA4 measurement ID" };
  if (!/^G-[A-Z0-9]{4,20}$/.test(v))
    return {
      ok: false,
      error: "A GA4 measurement ID looks like G-XXXXXXXX.",
    };
  return { ok: true, value: v };
}

/**
 * Tokens only ever travel in an Authorization header, so this is a sanity and
 * length check rather than an injection guard. Still strict: a token containing
 * whitespace or control characters is a copy-paste accident, and storing it
 * would produce a 401 nobody can explain.
 */
export function validateToken(raw: unknown): ValidationResult {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Empty token" };
  if (v.length < 20) return { ok: false, error: "That token looks too short." };
  if (v.length > 500) return { ok: false, error: "That token looks too long." };
  if (!/^[A-Za-z0-9._\-|]+$/.test(v))
    return {
      ok: false,
      error: "That token contains unexpected characters — paste it again.",
    };
  return { ok: true, value: v };
}

const id = () => `px-${randomBytes(8).toString("hex")}`;

// ── reads ───────────────────────────────────────────────────────────────────

function rowToPixel(r: any): PartnerPixel {
  return {
    provider: r.provider,
    pixelId: r.pixel_id,
    label: r.label || "",
    enabled: !!r.enabled,
    hasToken: !!r.token_enc,
    tokenHint: r.token_enc ? secretHint(r.token_enc) : null,
    updatedAt: Number(r.updated_at) || 0,
  };
}

/** A partner's own pixels, for their panel. Tokens reduced to a hint. */
export function pixelsForAffiliate(affiliateId: string): PartnerPixel[] {
  return (
    db
      .prepare(
        `SELECT provider, pixel_id, label, enabled, token_enc, updated_at
           FROM tracking_pixels WHERE affiliate_id = ? ORDER BY provider`,
      )
      .all(affiliateId) as any[]
  ).map(rowToPixel);
}

/**
 * The pixel ids that may be rendered into a page for this affiliate.
 *
 * Deliberately returns ids only. This value crosses to the client, so a token
 * reaching it would be a credential on the wire and in the page source.
 * Disabled pixels are excluded, and so are pixels for a partner who is not
 * approved — a suspended partner's traffic stops being measured, which is what
 * suspension has to mean.
 */
export function publicPixelsForCode(code: string): Array<{
  provider: AffiliateProvider;
  pixelId: string;
}> {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (!c) return [];
  const rows = db
    .prepare(
      `SELECT p.provider, p.pixel_id
         FROM tracking_pixels p
         JOIN affiliates a ON a.id = p.affiliate_id
        WHERE upper(a.code) = ? AND p.enabled = 1 AND a.status = 'approved'`,
    )
    .all(c) as Array<{ provider: AffiliateProvider; pixel_id: string }>;

  // Mapped into plain objects, for two reasons that both bite at runtime and
  // neither of which TypeScript can see:
  //
  //   • A `node:sqlite` row has a NULL prototype, and this value is passed from
  //     a Server Component into a Client Component. React refuses to serialise
  //     anything that is not a plain object, so returning the rows directly
  //     crashed every landing page that had a partner pixel on it.
  //   • The column is `pixel_id` and the consumer reads `pixelId`. The previous
  //     `as` cast asserted the camelCase name without the SQL ever producing it,
  //     so the type checked, the value was undefined, and the pixel would have
  //     silently never fired even once the crash was fixed.
  return rows.map((r) => ({
    provider: r.provider,
    pixelId: String(r.pixel_id),
  }));
}

/** Everything the dispatcher needs to send on a partner's behalf. */
export function sendConfigForCode(code: string | null | undefined): {
  pixelId: string;
  token: string | null;
} | null {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (!c) return null;
  const row = db
    .prepare(
      `SELECT p.pixel_id, p.token_enc
         FROM tracking_pixels p
         JOIN affiliates a ON a.id = p.affiliate_id
        WHERE upper(a.code) = ? AND p.provider = 'meta' AND p.enabled = 1
          AND a.status = 'approved'`,
    )
    .get(c) as { pixel_id: string; token_enc: string | null } | undefined;
  if (!row) return null;
  return { pixelId: row.pixel_id, token: decryptSecret(row.token_enc) };
}

// ── writes ──────────────────────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; pixel: PartnerPixel }
  | { ok: false; error: string; status: number };

/**
 * Create or replace a partner's pixel for one provider.
 *
 * `token` is optional: a browser pixel needs only the id, and plenty of partners
 * will start there. Passing an empty token leaves an existing one alone rather
 * than clearing it, because a form that does not render the token cannot be
 * expected to send it back.
 */
export function savePixel(input: {
  affiliateId: string;
  provider: AffiliateProvider;
  pixelId: unknown;
  token?: unknown;
  clearToken?: boolean;
  label?: unknown;
  enabled?: boolean;
}): SaveResult {
  const provider = input.provider;
  if (provider !== "meta" && provider !== "ga4")
    return { ok: false, error: "Unknown provider", status: 400 };

  const validated =
    provider === "meta"
      ? validateMetaPixelId(input.pixelId)
      : validateGa4MeasurementId(input.pixelId);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  const existing = db
    .prepare(
      `SELECT id, token_enc FROM tracking_pixels
        WHERE affiliate_id = ? AND provider = ?`,
    )
    .get(input.affiliateId, provider) as
    | { id: string; token_enc: string | null }
    | undefined;

  let tokenEnc = existing?.token_enc ?? null;

  if (input.clearToken) {
    tokenEnc = null;
  } else if (input.token !== undefined && String(input.token).trim() !== "") {
    const tv = validateToken(input.token);
    if (!tv.ok) return { ok: false, error: tv.error, status: 400 };
    if (!encryptionAvailable())
      return {
        ok: false,
        error:
          "Server-side conversion tracking is not available right now — the pixel will still work in the browser. Please tell us if you need it.",
        status: 503,
      };
    const enc = encryptSecret(tv.value);
    if (!enc)
      return {
        ok: false,
        error: "Could not store that token securely. Nothing was saved.",
        status: 503,
      };
    tokenEnc = enc;
  }

  const now = Date.now();
  const label = String(input.label ?? "")
    .trim()
    .slice(0, 60);
  const enabled = input.enabled === false ? 0 : 1;

  if (existing) {
    db.prepare(
      `UPDATE tracking_pixels
          SET pixel_id = ?, token_enc = ?, label = ?, enabled = ?, updated_at = ?
        WHERE id = ?`,
    ).run(validated.value, tokenEnc, label, enabled, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO tracking_pixels
         (id, affiliate_id, provider, pixel_id, token_enc, label, enabled,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id(),
      input.affiliateId,
      provider,
      validated.value,
      tokenEnc,
      label,
      enabled,
      now,
      now,
    );
  }

  const saved = pixelsForAffiliate(input.affiliateId).find(
    (p) => p.provider === provider,
  );
  return { ok: true, pixel: saved! };
}

export function deletePixel(affiliateId: string, provider: string): boolean {
  const res = db
    .prepare(
      `DELETE FROM tracking_pixels WHERE affiliate_id = ? AND provider = ?`,
    )
    .run(affiliateId, provider);
  return Number(res.changes || 0) > 0;
}
