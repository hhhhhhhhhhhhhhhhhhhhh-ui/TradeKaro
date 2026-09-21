// Consent, decided by where the visitor actually is.
//
// THE POLICY
//
// A cookie banner is shown ONLY where the law requires one. Everywhere else the
// visitor gets no interruption and the tags fire normally. For a business whose
// traffic is overwhelmingly Indian, a banner shown to everyone would cost
// signups to satisfy a rule that does not apply to them.
//
// India is deliberately NOT on the list. The DPDP Act 2023 does not yet impose
// the ePrivacy-style prior-consent rule for analytics and advertising cookies
// that the EEA has, so showing Indian visitors a banner would be pure friction.
//
// THE FAILURE MODE, AND WHY IT IS THIS WAY
//
// When we cannot tell where the visitor is, this says consent is NOT required,
// so no banner is shown and the tags load.
//
// That is a deliberate business decision, not an oversight, and it has a real
// cost worth stating plainly: if the geolocation header ever goes missing in
// production — a proxy change, an origin deployed outside the CDN, a
// misconfigured WAF rule — every visitor including the EEA ones is treated as
// exempt and gets no banner. EEA privacy regulators expect a banner there.
//
// The opposite default (assume required) fails the other way: a missing header
// shows the banner to everyone worldwide, which costs signups but is legal.
//
// It was set to "required" first and changed on request. To switch it back
// without editing this file, set TRACKING_CONSENT_DEFAULT=required in the
// environment. Worth doing if the geo header is ever in doubt.
//
// `TRACKING_GEO` forces a country, for testing a banner you would otherwise
// never see from a local machine.

/** True when the visitor's jurisdiction requires prior consent for ad/analytics cookies. */
export const CONSENT_REQUIRED_COUNTRIES = new Set([
  // EEA — GDPR + ePrivacy. The 27 member states:
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA — the three non-EU members, which apply the same directive:
  "IS",
  "LI",
  "NO",
  // UK — UK GDPR + PECR:
  "GB",
  // Switzerland — revFADP:
  "CH",
  // Brazil — LGPD, where opt-in is the accepted practice for this class of cookie:
  "BR",
  // South Korea — PIPA, which requires prior consent:
  "KR",
]);

/** The cookie holding the visitor's own answer. Readable by the client. */
export const CONSENT_COOKIE = "tc_consent";
/** How long the answer is remembered. A year is the common ceiling. */
export const CONSENT_TTL_DAYS = 180;

export type ConsentDecision = "granted" | "denied" | "exempt";

/**
 * Does this country require a banner?
 *
 * `null`, `""`, `XX` and `T1` all mean "we do not know": Cloudflare returns `XX`
 * for an unroutable address and `T1` for Tor, and neither is a jurisdiction we
 * can make a claim about. They all fall to NOT REQUIRED — see the note at the
 * top of this file for what that costs and how to reverse it.
 */
export function consentRequiredForCountry(
  country: string | null | undefined,
): boolean {
  const override = process.env.TRACKING_CONSENT_DEFAULT;
  if (override === "exempt") return false;
  if (override === "required") return true;

  const cc = String(country || "")
    .trim()
    .toUpperCase();
  if (!cc || cc === "XX" || cc === "T1") return false;
  return CONSENT_REQUIRED_COUNTRIES.has(cc);
}

/**
 * The visitor's country, as reported by the edge.
 *
 * Cloudflare adds `CF-IPCountry` to proxied origin requests by default. The env
 * override exists for local development, where there is no edge and therefore no
 * header — without it every local page view would look like an unknown
 * jurisdiction and show the banner, which is fine for testing the banner and
 * useless for testing anything else.
 *
 * NOTE: this is a HINT, not a security control. A visitor can spoof the header
 * through their own proxy. It only decides whether to *offer* a choice, so
 * getting it wrong has a cosmetic cost — what actually matters is that the
 * recorded decision is honest, which is the client's job.
 */
export function countryFromHeaders(h: Headers): string {
  const forced = process.env.TRACKING_GEO;
  if (forced) return forced.toUpperCase();
  return (h.get("cf-ipcountry") || h.get("x-country") || "").toUpperCase();
}

/** Cookie string for the visitor's answer. */
export function consentCookie(
  decision: Exclude<ConsentDecision, "exempt">,
): string {
  return `${CONSENT_COOKIE}=${decision}; path=/; max-age=${
    CONSENT_TTL_DAYS * 86400
  }; samesite=lax`;
}
