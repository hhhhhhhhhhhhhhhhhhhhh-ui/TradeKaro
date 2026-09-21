// Ad click IDs and campaign parameters, captured at first touch.
//
// WHY THIS EXISTS
//
// An ad platform's click identifier — `fbclid` from Meta, `gclid` from Google —
// is the only durable way to match a later signup or deposit back to the ad that
// paid for it. It arrives in the query string, it lives for days, and once the
// visitor navigates away it is gone for good.
//
// So it is snapshotted onto the click row the moment the visitor lands, even
// though nothing reads it yet. That is the entire point of this phase: the
// pixels come later, and any click captured before then can still be matched
// retroactively. Every day without this is ad data permanently lost.
//
// WHAT THESE VALUES ARE
//
// Opaque provider tokens. We never parse them, never validate their shape and
// never derive meaning from them — we store them verbatim and hand them back to
// the provider that issued them. Do not "fix" a value that looks malformed; a
// mangled token forwarded is a failed conversion, a mangled token *edited* is a
// silent one.
//
// This module is the single source of truth for the allowlist. The short-link
// redirect and the landing pages both read it, so the two can never disagree
// about which params to carry.

/** Click identifiers issued by ad platforms. */
export const AD_PARAMS = [
  "fbclid", // Meta
  "gclid", // Google Ads
  "wbraid", // Google — iOS app to web
  "gbraid", // Google — iOS app to web
  "dclid", // Google Display / DV360
  "msclkid", // Microsoft Ads
  "ttclid", // TikTok
  "twclid", // X
] as const;

/** Campaign descriptors. Free-form by spec, so they are only trimmed and capped. */
export const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
] as const;

export const SIGNAL_PARAMS = [...AD_PARAMS, ...CAMPAIGN_PARAMS] as const;

const SIGNAL_SET = new Set<string>(SIGNAL_PARAMS);

/**
 * Cap per value. Real click IDs are ~40-150 chars; 200 leaves room for a long
 * `utm_content` while keeping a hostile URL from writing a novel into the table.
 */
const MAX_LEN = 200;

export type ClickSignals = Record<string, string>;

/**
 * Pull the allowlisted params out of anything query-shaped.
 *
 * Accepts a `URLSearchParams` (route handlers) or a plain record (the
 * `searchParams` object Next hands a page), because the two call sites get their
 * input in different shapes and normalising here is what stops the short link
 * and the landing page drifting apart.
 *
 * Unknown keys are dropped rather than stored. This table is not a place to
 * archive whatever a visitor thought to append.
 */
export function pickSignals(
  src: URLSearchParams | Record<string, unknown> | null | undefined,
): ClickSignals {
  const out: ClickSignals = {};
  if (!src) return out;

  const read = (key: string): string | null => {
    if (src instanceof URLSearchParams) return src.get(key);
    const v = (src as Record<string, unknown>)[key];
    if (v === undefined || v === null) return null;
    // Next gives a page `string | string[]` for repeated params. An array means
    // someone passed the same param twice — take the first rather than inventing
    // a join.
    if (Array.isArray(v)) return v.length ? String(v[0]) : null;
    return String(v);
  };

  for (const key of SIGNAL_PARAMS) {
    if (!SIGNAL_SET.has(key)) continue;
    const raw = read(key);
    if (!raw) continue;
    const v = raw.trim().slice(0, MAX_LEN);
    if (v) out[key] = v;
  }
  return out;
}

/** Read signals back off a stored row. Never throws — a corrupt blob is "none". */
export function parseSignals(raw: unknown): ClickSignals {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return pickSignals(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** JSON for storage, or null when there is nothing worth a column. */
export function serialiseSignals(
  signals: ClickSignals | null | undefined,
): string | null {
  if (!signals) return null;
  const clean = pickSignals(signals);
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** True when the bag carries a platform click id (not just a utm tag). */
export function hasAdClickId(signals: ClickSignals): boolean {
  return AD_PARAMS.some((p) => Boolean(signals[p]));
}

/**
 * Meta's `fbc` format, built from a stored `fbclid`.
 *
 * Meta itself would set a `_fbc` cookie at click time, but only once the pixel
 * exists — which it does not yet. Constructing it from the `fbclid` we did
 * capture is what makes those older clicks usable by Conversions API later,
 * and it is the single highest-value reason for storing `fbclid` now.
 */
export function fbcFromFbclid(fbclid: string, ts: number): string {
  return `fb.1.${ts}.${fbclid}`;
}
