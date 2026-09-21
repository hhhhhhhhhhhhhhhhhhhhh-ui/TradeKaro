// The conversion event map — internal moments, in the vocabulary the ad
// platforms speak.
//
// WHY A MAP AT ALL
//
// Every platform has its own names for the same four things, and getting one
// wrong does not throw: Meta silently drops an event it does not recognise, and
// Google counts it as a custom event that no campaign can optimise against. So
// the names live in exactly one place and every call site picks from it.
//
// This module is PURE — no database, no Node built-ins — because the browser
// needs the same map the server does. Anything that touches the database
// belongs in `conversions.ts` instead.
//
// DEDUPLICATION, WHICH IS THE OTHER HALF OF THE JOB
//
// The same real-world event is reported twice: once from the browser pixel and
// once from the server (Phase 4's Conversions API). Meta and Google both collapse
// the pair only if the two share an identifier, so the id has to be agreed
// before either fires.
//
// Random ids would not survive that handshake — the server's uuid is not the
// browser's uuid. So ids are DERIVED from the thing that happened:
//
//   CompleteRegistration  → signup:<userId>
//   Purchase              → deposit:<depositRowId>
//
// That makes them unique per event, identical on both sides, and idempotent for
// free: a retried webhook or a refreshed success page derives the same id, and
// the unique index in `conversion_events` refuses the duplicate row rather than
// paying a partner twice or telling Meta about a purchase that happened once.

export type CanonicalEvent =
  | "PageView"
  | "Lead"
  | "CompleteRegistration"
  | "Purchase";

/**
 * Canonical name → the name each platform expects.
 *
 * `Lead` maps to `begin_checkout` rather than `generate_lead` on the Google side
 * on purpose: the moment being reported is someone starting the signup flow, not
 * a completed enquiry, and `begin_checkout` is the funnel step Google will
 * actually optimise against.
 */
export const PROVIDER_EVENT: Record<
  CanonicalEvent,
  { meta: string; ga4: string }
> = {
  PageView: { meta: "PageView", ga4: "page_view" },
  Lead: { meta: "Lead", ga4: "begin_checkout" },
  CompleteRegistration: { meta: "CompleteRegistration", ga4: "sign_up" },
  Purchase: { meta: "Purchase", ga4: "purchase" },
};

/** Everything this platform bills in. */
export const CURRENCY = "INR";

/** Stable id for the account-created event. */
export function signupEventId(userId: string | number): string {
  return `signup:${String(userId).trim()}`;
}

/** Stable id for the money-in event. */
export function depositEventId(depositRowId: string | number): string {
  return `deposit:${String(depositRowId).trim()}`;
}

/**
 * A random id for an event with no server-side counterpart to anchor to.
 *
 * Only `Lead` currently uses this, and only in the browser. It exists so every
 * event carries an id uniformly — a funnel where half the steps are traceable is
 * worse than one where none are, because it hides which half is missing.
 */
export function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Consent as recorded against an event.
 *
 * `unknown` is a real state, not a synonym for `denied`. Phase 4 treats both as
 * "do not forward", but they are different problems: `denied` is a decision
 * being honoured, `unknown` is a gap that should be closed.
 */
export type EventConsent = "granted" | "denied" | "exempt" | "unknown";

/**
 * Decide the consent an event is reported under.
 *
 * The visitor's own answer wins, because it is the most recent thing they said
 * and they are allowed to change their mind. Failing that, whatever the click
 * was recorded as. Failing both, we do not know, and saying so is the honest
 * answer.
 */
export function resolveConsent(
  explicit: string | null | undefined,
  fromClick: string | null | undefined,
): EventConsent {
  const pick = (v: string | null | undefined) => {
    const s = String(v || "")
      .trim()
      .toLowerCase();
    return s === "granted" || s === "denied" || s === "exempt" ? s : null;
  };
  return (pick(explicit) || pick(fromClick) || "unknown") as EventConsent;
}
