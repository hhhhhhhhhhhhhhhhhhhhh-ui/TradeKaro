// Recording a conversion event server-side.
//
// This is the write half of the outbox described on `conversion_events` in
// `db.ts`. It is called at the moment the thing actually happened — an account
// being created, a deposit being credited — and it must never fail the caller.
// An account that cannot be created because a marketing table was unhappy is a
// worse outcome than a missing conversion, so every call site wraps it.

import { db } from "./db";
import { affiliateUserId } from "./affiliates";
import { enqueueDeliveries } from "./conversionsDispatch";
import {
  CURRENCY,
  resolveConsent,
  type CanonicalEvent,
  type EventConsent,
} from "./trackingEvents";

export type RecordedEvent = {
  eventId: string;
  /** False when the row already existed — a replay, not a new conversion. */
  inserted: boolean;
  consent: EventConsent;
  affiliateCode: string | null;
  clickId: number | null;
  /** Delivery rows opened, one per provider with credentials. */
  queued: number;
};

/**
 * The affiliate click this customer arrived on, if there was one.
 *
 * `attributeSignup` stamps the winning click with the user id at signup, and
 * only ever one — first binding wins. So this is a lookup, not a computation,
 * and it carries the ad click ids and the consent recorded at landing time.
 */
function clickForUser(userId: string) {
  const bare = affiliateUserId(userId) || String(userId);
  return db
    .prepare(
      `SELECT id, code, consent
         FROM affiliate_clicks
        WHERE user_id = ?
        ORDER BY ts ASC
        LIMIT 1`,
    )
    .get(bare) as
    | { id: number; code: string; consent: string | null }
    | undefined;
}

/**
 * Write a conversion event.
 *
 * `explicitConsent` is the visitor's own answer, read from the `tc_consent`
 * cookie at the moment of the request. It outranks whatever the click row says,
 * because a visitor may have answered after the click was recorded.
 *
 * Idempotent by `event_id`: recording the same event twice returns the existing
 * row rather than creating a second one. That is what stops a retried payment
 * webhook from reporting a purchase to Meta twice and, later, from a partner
 * being credited for a deposit that happened once.
 */
export function recordConversionEvent(input: {
  name: CanonicalEvent;
  eventId: string;
  userId?: string | null;
  value?: number | null;
  currency?: string | null;
  /** The visitor's own consent answer, when we have it. */
  explicitConsent?: string | null;
  /** GA4's browser client id, carried so a later webhook event can be attributed. */
  gaClientId?: string | null;
  /** The visitor's own ip and user agent. Omit when there is no visitor. */
  ip?: string | null;
  ua?: string | null;
  at?: number;
}): RecordedEvent {
  const eventId = String(input.eventId || "").trim();
  if (!eventId) throw new Error("recordConversionEvent needs an eventId");

  // Store the BARE user id.
  //
  // Callers reach here from both sides of a divide: the signup route has the
  // bare id, while the deposit path is handed `u-<id>` as its ledger key
  // (`recordDeposit` is always called that way). Persisting whichever form
  // happened to arrive would put the same customer in this table under two
  // identities — and `affiliate_clicks.user_id` is already bare, so any join
  // between the two would silently match nothing.
  //
  // That exact mismatch is not hypothetical here: it previously meant no
  // deposit ever paid a partner, and it was invisible because the panels showed
  // clicks and customers and simply no money. Normalising on the way in is
  // idempotent, so a bare id stays bare and a prefixed one loses the prefix.
  const rawUserId = input.userId ? String(input.userId) : null;
  const userId = rawUserId ? affiliateUserId(rawUserId) || rawUserId : null;

  const click = userId ? clickForUser(userId) : undefined;
  const consent = resolveConsent(input.explicitConsent, click?.consent);

  const existing = db
    .prepare(`SELECT id, consent FROM conversion_events WHERE event_id = ?`)
    .get(eventId) as { id: number; consent: string | null } | undefined;

  if (existing)
    return {
      eventId,
      inserted: false,
      consent: (existing.consent as EventConsent) || consent,
      affiliateCode: click?.code ?? null,
      clickId: click?.id ?? null,
      queued: 0,
    };

  const at = input.at || Date.now();
  const value =
    typeof input.value === "number" && Number.isFinite(input.value)
      ? input.value
      : null;

  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, affiliate_code, click_id, value, currency,
        consent, ga_client_id, client_ip, client_ua, occurred_at, created_at,
        dispatched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(event_id) DO NOTHING`,
  ).run(
    eventId,
    input.name,
    userId,
    click?.code ?? null,
    click?.id ?? null,
    value,
    input.currency || CURRENCY,
    consent,
    input.gaClientId ? String(input.gaClientId).slice(0, 120) : null,
    input.ip ? String(input.ip).slice(0, 64) : null,
    input.ua ? String(input.ua).slice(0, 400) : null,
    at,
    Date.now(),
  );

  // Open the delivery rows now, while the event is fresh. Sending happens later
  // and elsewhere — recording must never wait on an ad network.
  let queued = 0;
  try {
    queued = enqueueDeliveries(eventId, at);
  } catch {
    /* the event is recorded; dispatch can be backfilled */
  }

  return {
    eventId,
    inserted: true,
    consent,
    affiliateCode: click?.code ?? null,
    clickId: click?.id ?? null,
    queued,
  };
}

/** Read the visitor's consent answer out of a raw `Cookie:` header. */
export function consentFromCookieHeader(cookieHeader: string | null): string {
  const m = /(?:^|;\s*)tc_consent=([^;]+)/.exec(String(cookieHeader || ""));
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * GA4's client id, out of the `_ga` cookie gtag sets.
 *
 * The cookie looks like `GA1.1.1234567890.1699999999`, and the client id is
 * everything after the version prefix — taking the whole string would produce an
 * id GA4 has never seen, so the event would arrive and join nothing.
 */
export function gaClientIdFromCookie(cookieHeader: string | null): string {
  const m = /(?:^|;\s*)_ga=([^;]+)/.exec(String(cookieHeader || ""));
  if (!m) return "";
  const value = decodeURIComponent(m[1]);
  const parts = value.split(".");
  return parts.length >= 4 ? parts.slice(2).join(".") : "";
}

/**
 * Events still owed to the platforms. Phase 4's dispatcher drains this; until
 * then it is also the honest answer to "what did we capture but never send".
 */
export function pendingConversionEvents(limit = 50) {
  return db
    .prepare(
      `SELECT event_id, name, user_id, affiliate_code, click_id, value, currency,
              consent, occurred_at
         FROM conversion_events
        WHERE dispatched_at IS NULL
        ORDER BY occurred_at ASC
        LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
}

export function conversionEventCounts() {
  return db
    .prepare(
      `SELECT name,
              COUNT(*) AS total,
              SUM(CASE WHEN dispatched_at IS NULL THEN 1 ELSE 0 END) AS pending
         FROM conversion_events
        GROUP BY name
        ORDER BY name`,
    )
    .all() as Array<{ name: string; total: number; pending: number }>;
}
