// Delivery of conversion events to Meta and Google.
//
// The write side (`conversions.ts`) records what happened. This is the send
// side, and it is deliberately asynchronous: a signup must never wait on, or
// fail because of, an ad network.
//
// THREE THINGS THIS HAS TO GET RIGHT
//
// 1. CONSENT IS CHECKED HERE, AT SEND TIME, NOT AT RECORD TIME.
//    An event is recorded the instant the account exists. Whether we may tell
//    Meta about it is a separate question, and the answer can change between
//    those two moments. `granted` and `exempt` may be sent. `denied`, `unknown`
//    and NULL may not — an unanswered banner is not permission. A blocked event
//    is marked `skipped` with a reason and is never retried.
//
// 2. PII IS HASHED, NEVER SENT RAW.
//    Email and phone go out as SHA-256 hex of the normalised value, which is
//    what Meta's advanced matching expects. This function has no code path that
//    can put a raw address on the wire.
//
// 3. FAILURE IS EXPECTED AND SURVIVABLE.
//    Meta being down, slow or rate-limiting must not lose the event. Attempts
//    are counted, backed off, and given up on — visibly, in a row an operator
//    can read — rather than retried forever or dropped without trace.

import { createHash } from "crypto";
import { db } from "./db";
import { affiliateUserId } from "./affiliates";
import { PROVIDER_EVENT, type CanonicalEvent } from "./trackingEvents";
import { parseSignals, fbcFromFbclid } from "./tracking";
import { publicBaseUrl } from "./requestProto";
import { sendConfigForCode } from "./pixels";

export type Provider = "meta" | "ga4" | "meta_affiliate";

/** Where a delivery stands. `skipped` is terminal and means "we chose not to". */
export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

const MAX_ATTEMPTS = 5;

/**
 * Backoff between attempts, in milliseconds, indexed by attempt number.
 * First retry after a minute rather than immediately: most failures here are
 * transient and the common case is a blip, not an outage.
 */
const BACKOFF = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  15 * 60_000, // 15 min
  60 * 60_000, // 1 hour
  6 * 60 * 60_000, // 6 hours
];

/** Meta refuses events older than seven days, so there is no point queueing them. */
const META_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

// ── configuration ───────────────────────────────────────────────────────────

export function providerConfig() {
  return {
    meta: {
      pixelId: process.env.META_PIXEL_ID || "",
      token: process.env.META_CAPI_TOKEN || "",
      version: process.env.META_API_VERSION || "v21.0",
      // Overridable so the send path can be pointed at a mock. Testing this
      // against the real Graph API is not possible — it needs live credentials
      // and it counts real conversions when you succeed.
      base: process.env.META_GRAPH_BASE || "https://graph.facebook.com",
    },
    ga4: {
      measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "",
      apiSecret: process.env.GA4_API_SECRET || "",
      base: process.env.GA4_MP_BASE || "https://www.google-analytics.com",
    },
  };
}

/** Which providers have credentials, and therefore which get delivery rows. */
export function configuredProviders(): Provider[] {
  const c = providerConfig();
  const out: Provider[] = [];
  if (c.meta.pixelId && c.meta.token) out.push("meta");
  if (c.ga4.measurementId && c.ga4.apiSecret) out.push("ga4");
  return out;
}

// ── identity ────────────────────────────────────────────────────────────────

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Lowercased and trimmed, which is what Meta normalises to before hashing. */
export function hashEmail(email: string): string | null {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return e ? sha256(e) : null;
}

/**
 * Digits only, with the country code, which Meta requires and is strict about.
 *
 * Our stored numbers are the 10-digit local form, so the country code is added
 * here. Getting this wrong does not error — the hash simply never matches
 * anybody, and the match rate quietly falls with no way to tell why.
 */
export function hashPhone(phone: string): string | null {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) d = `91${d}`; // India, the only market we serve
  if (d.length < 11) return null;
  return sha256(d);
}

type EventIdentity = {
  email: string | null;
  phone: string | null;
  ip: string | null;
  ua: string | null;
  fbc: string | null;
  fbclid: string | null;
  gaClientId: string | null;
  landing: string | null;
  campaign: string | null;
};

/**
 * Everything the providers need to match this event to a person.
 *
 * The click row is the richest source: it holds the ad click ids captured at
 * first touch, which is the whole reason Phase 1 exists. A conversion with no
 * click behind it (organic traffic) still goes out, just with less to match on.
 */
function identityFor(
  userId: string | null,
  clickId: number | null,
  gaClientId: string | null,
  own: { ip?: string | null; ua?: string | null } = {},
): EventIdentity {
  const user = userId
    ? (db.prepare(`SELECT email, phone FROM users WHERE id = ?`).get(userId) as
        | { email?: string; phone?: string }
        | undefined)
    : undefined;

  const click = clickId
    ? (db
        .prepare(
          `SELECT ip, ua, landing, campaign, signals
             FROM affiliate_clicks WHERE id = ?`,
        )
        .get(clickId) as
        | {
            ip?: string;
            ua?: string;
            landing?: string;
            campaign?: string;
            signals?: string;
          }
        | undefined)
    : undefined;

  const signals = parseSignals(click?.signals);
  const fbclid = signals.fbclid || null;

  return {
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    // The event's own values win: they were captured from the request that made
    // this event, whereas the click's belong to whatever visit happened before
    // it — possibly a different network entirely.
    ip: own.ip || click?.ip || null,
    ua: own.ua || click?.ua || null,
    fbclid,
    // Meta's own format. Reconstructed from the fbclid we captured, because the
    // `_fbc` cookie it would normally read only exists once the pixel does — and
    // these clicks mostly predate it.
    fbc: fbclid ? fbcFromFbclid(fbclid, Date.now()) : null,
    gaClientId,
    landing: click?.landing ?? null,
    campaign: click?.campaign ?? null,
  };
}

/**
 * GA4 needs a `client_id` to attribute anything. The browser's own id is
 * captured at signup; a later event (a deposit, arriving on a webhook with no
 * browser at all) inherits it from the user's earliest event that has one.
 *
 * Without this, a purchase would be sent with a synthetic id that GA4 cannot
 * tie to the session that started it — arriving, being counted, and joining
 * nothing.
 */
function clientIdFor(userId: string | null, explicit: string | null): string {
  if (explicit) return explicit;
  if (userId) {
    const row = db
      .prepare(
        `SELECT ga_client_id FROM conversion_events
          WHERE user_id = ? AND ga_client_id IS NOT NULL AND ga_client_id != ''
          ORDER BY occurred_at ASC LIMIT 1`,
      )
      .get(userId) as { ga_client_id?: string } | undefined;
    if (row?.ga_client_id) return row.ga_client_id;
  }
  // Last resort: stable, unique, and honest about being synthetic.
  return userId ? `user.${userId}` : `anon.${Date.now()}`;
}

// ── payloads ────────────────────────────────────────────────────────────────

export type EventRow = {
  event_id: string;
  name: string;
  user_id: string | null;
  affiliate_code: string | null;
  click_id: number | null;
  value: number | null;
  currency: string | null;
  ga_client_id: string | null;
  client_ip?: string | null;
  client_ua?: string | null;
  occurred_at: number;
  /** Set only when sending to a partner's own pixel. Never persisted. */
  __partnerPixel?: string | null;
};

export function buildMetaPayload(e: EventRow, base: string) {
  // The partner's pixel when we are sending on their behalf, otherwise ours.
  // Same payload shape either way — the numbers and the hashes are the same
  // conversion, it is only the destination that differs.
  const partner =
    e.affiliate_code && e.__partnerPixel
      ? {
          pixelId: e.__partnerPixel,
          version: process.env.META_API_VERSION || "v21.0",
          base: process.env.META_GRAPH_BASE || "https://graph.facebook.com",
        }
      : null;
  const cfg = partner || providerConfig().meta;
  const id = identityFor(e.user_id, e.click_id, e.ga_client_id, {
    ip: e.client_ip,
    ua: e.client_ua,
  });
  const em = hashEmail(id.email || "");
  const ph = hashPhone(id.phone || "");

  const user_data: Record<string, unknown> = {};
  // Only ever the hash. The raw value does not leave this process, and there is
  // no branch here that could send it.
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (id.fbc) user_data.fbc = id.fbc;
  if (id.ip) user_data.client_ip_address = id.ip;
  if (id.ua) user_data.client_user_agent = id.ua;

  const custom_data: Record<string, unknown> = {};
  if (typeof e.value === "number") custom_data.value = e.value;
  custom_data.currency = e.currency || "INR";

  return {
    url: `${cfg.base}/${cfg.version}/${cfg.pixelId}/events`,
    body: {
      data: [
        {
          event_name: PROVIDER_EVENT[e.name as CanonicalEvent]?.meta || e.name,
          // SECONDS. Meta rejects milliseconds, and the rejection is a 400 whose
          // message reads like a malformed timestamp rather than a unit error —
          // the kind of thing that costs an afternoon.
          event_time: Math.floor(e.occurred_at / 1000),
          event_id: e.event_id,
          action_source: "website",
          ...(id.landing
            ? { event_source_url: `${base}/l/${id.landing}` }
            : {}),
          user_data,
          custom_data,
        },
      ],
    },
  };
}

export function buildGa4Payload(e: EventRow, base: string) {
  const cfg = providerConfig().ga4;
  const client_id = clientIdFor(e.user_id, e.ga_client_id);
  return {
    url: `${cfg.base}/mp/collect?measurement_id=${encodeURIComponent(
      cfg.measurementId,
    )}&api_secret=${encodeURIComponent(cfg.apiSecret)}`,
    body: {
      client_id,
      events: [
        {
          name: PROVIDER_EVENT[e.name as CanonicalEvent]?.ga4 || e.name,
          params: {
            // The server-side twin of the browser event. Google dedupes on this
            // the way Meta dedupes on event_id.
            transaction_id: e.event_id,
            ...(typeof e.value === "number" ? { value: e.value } : {}),
            currency: e.currency || "INR",
            // A session-less server event still has to look like an engagement
            // to GA4, or it is filtered out of reports.
            engagement_time_msec: 1,
          },
        },
      ],
    },
  };
}

// ── queueing ────────────────────────────────────────────────────────────────

/**
 * Which providers this particular event should go to.
 *
 * The platform's own providers come from the environment. `meta_affiliate` is
 * different in kind: it depends on the event, because not every conversion has a
 * partner behind it and not every partner has configured a pixel. Queuing it
 * unconditionally would fill the table with rows that can only ever be skipped.
 *
 * A partner who adds their pixel later is handled by `backfill`, not by leaving
 * a pending row here — see `backfillDeliveries`.
 */
export function providersForEvent(eventId: string): Provider[] {
  const out = configuredProviders();
  const ev = db
    .prepare(`SELECT affiliate_code FROM conversion_events WHERE event_id = ?`)
    .get(eventId) as { affiliate_code: string | null } | undefined;
  if (ev?.affiliate_code && sendConfigForCode(ev.affiliate_code))
    out.push("meta_affiliate");
  return out;
}

/**
 * Open a delivery row per applicable provider.
 *
 * Only where something can actually be sent. A row for a provider nobody has
 * configured would sit pending forever and grow the queue without ever becoming
 * sendable; instead nothing is queued, and `backfill` picks these events up the
 * moment credentials appear. Nothing is lost by waiting.
 */
export function enqueueDeliveries(eventId: string, now = Date.now()): number {
  const providers = providersForEvent(eventId);
  let n = 0;
  for (const p of providers) {
    const res = db
      .prepare(
        `INSERT INTO conversion_deliveries
           (event_id, provider, status, attempts, next_attempt_at, created_at)
         VALUES (?,?, 'pending', 0, ?, ?)
         ON CONFLICT(event_id, provider) DO NOTHING`,
      )
      .run(eventId, p, now, now);
    n += Number(res.changes || 0);
  }
  return n;
}

/** Queue every recorded event that has no delivery row for a configured provider. */
export function backfillDeliveries(limit = 500, now = Date.now()) {
  const providers = configuredProviders();
  if (!providers.length) return { queued: 0, providers: [] as Provider[] };

  const events = db
    .prepare(
      `SELECT event_id FROM conversion_events ORDER BY occurred_at ASC LIMIT ?`,
    )
    .all(limit) as Array<{ event_id: string }>;

  let queued = 0;
  for (const e of events) queued += enqueueDeliveries(e.event_id, now);
  return { queued, providers };
}

// ── dispatch ────────────────────────────────────────────────────────────────

export type DispatchOutcome = {
  eventId: string;
  provider: Provider;
  status: DeliveryStatus;
  reason?: string;
  response?: string;
};

export type DispatchReport = {
  considered: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  outcomes: DispatchOutcome[];
  /** Payloads only, populated by a dry run so nothing leaves the building. */
  previews?: Array<{ provider: Provider; url: string; body: unknown }>;
  configured: Provider[];
};

/** Something went wrong and trying again might help. */
class Retryable extends Error {}
/** Something went wrong and it will not get better. */
class Permanent extends Error {}

async function deliver(
  provider: Provider,
  e: EventRow,
  base: string,
): Promise<string> {
  const target =
    provider === "meta" || provider === "meta_affiliate"
      ? buildMetaPayload(e, base)
      : buildGa4Payload(e, base);
  const cfg = providerConfig();

  // Whose credential travels with this request. A partner's token is theirs —
  // using ours to report into their pixel would be both wrong and useless, and
  // Meta answers a mismatched token with a 401 that reads like a bad pixel id.
  let authorization: string | undefined;
  if (provider === "meta") authorization = `Bearer ${cfg.meta.token}`;
  else if (provider === "meta_affiliate") {
    const partner = sendConfigForCode(e.affiliate_code);
    if (!partner?.token) throw new Permanent("partner token unavailable");
    authorization = `Bearer ${partner.token}`;
  }

  const res = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(target.body),
    // A hung ad platform must not hold a worker open indefinitely.
    signal: AbortSignal.timeout ? AbortSignal.timeout(10_000) : undefined,
  });

  if (res.status >= 500) throw new Retryable(`HTTP ${res.status}`);
  if (res.status === 429) throw new Retryable("rate limited");
  // 401/403 is a bad or expired token — an operator problem, and one an
  // operator fixes. Classifying it as permanent would burn every queued
  // conversion the moment a token rotated, and the events would be gone by the
  // time anyone noticed. Retrying keeps them alive across the fix.
  if (res.status === 401 || res.status === 403)
    throw new Retryable(`HTTP ${res.status} — check the credentials`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Permanent(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return `HTTP ${res.status}`;
}

/**
 * Send what is owed.
 *
 * Bounded by `limit` so this can be called from a request path without a
 * pathological queue turning one page view into minutes of work.
 */
export async function dispatchPendingConversions(
  opts: {
    limit?: number;
    now?: number;
    dryRun?: boolean;
    base?: string;
  } = {},
): Promise<DispatchReport> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const now = opts.now ?? Date.now();
  const base = opts.base || "https://tradestox.pro";

  const report: DispatchReport = {
    considered: 0,
    sent: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
    outcomes: [],
    configured: configuredProviders(),
  };

  const due = db
    .prepare(
      `SELECT d.id AS delivery_id, d.event_id, d.provider, d.attempts,
              e.name, e.user_id, e.click_id, e.value, e.currency,
              e.consent, e.ga_client_id, e.client_ip, e.client_ua,
              e.affiliate_code, e.occurred_at
         FROM conversion_deliveries d
         JOIN conversion_events e ON e.event_id = d.event_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= ?
        ORDER BY d.next_attempt_at ASC
        LIMIT ?`,
    )
    .all(now, limit) as Array<Record<string, any>>;

  if (opts.dryRun) report.previews = [];

  for (const row of due) {
    report.considered++;
    const provider = row.provider as Provider;
    const event: EventRow = {
      event_id: row.event_id,
      name: row.name,
      user_id: row.user_id,
      affiliate_code: row.affiliate_code,
      click_id: row.click_id,
      value: row.value,
      currency: row.currency,
      ga_client_id: row.ga_client_id,
      client_ip: row.client_ip,
      client_ua: row.client_ua,
      occurred_at: row.occurred_at,
    };

    const close = (
      status: DeliveryStatus,
      reason: string | undefined,
      response: string | undefined,
      attempts: number,
      nextAt: number,
    ) => {
      db.prepare(
        `UPDATE conversion_deliveries
            SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?,
                response = ?, delivered_at = ?
          WHERE id = ?`,
      ).run(
        status,
        attempts,
        nextAt,
        reason ?? null,
        response ?? null,
        status === "sent" ? now : null,
        row.delivery_id,
      );
      report.outcomes.push({
        eventId: row.event_id,
        provider,
        status,
        reason,
        response,
      });
    };

    // ── consent, checked at the last possible moment ──
    const consent = String(row.consent || "").toLowerCase();
    if (consent !== "granted" && consent !== "exempt") {
      close("skipped", `no_consent:${consent || "null"}`, undefined, 0, 0);
      report.skipped++;
      continue;
    }

    // ── never send a fixture ──
    //
    // The test suites create real signups and real deposits, which means real
    // conversion events. Sending those to Meta would put invented conversions
    // into a live ad account: it would spend the partner's budget chasing them
    // and it would make every conversion rate we report wrong.
    //
    // Cleaning up after each suite is not sufficient — smoke.mjs and the two
    // verify scripts predate conversion events entirely, so their cleanups do
    // not know these tables exist and the rows accumulate silently. A guard at
    // the point of sending is the only place that holds no matter who forgets.
    if (isFixtureUser(event.user_id)) {
      close("skipped", "fixture_account", undefined, 0, 0);
      report.skipped++;
      continue;
    }

    // Meta will not accept an event this old, so retrying cannot help.
    if (
      provider === "meta" &&
      now - Number(row.occurred_at) > META_MAX_AGE_MS
    ) {
      close("skipped", "too_old_for_meta", undefined, 0, 0);
      report.skipped++;
      continue;
    }

    // ── the partner's own pixel ──
    //
    // Neither branch below is a failure. The partner's browser pixel already
    // fired on the landing page; this is the server-side twin, and a partner who
    // has supplied only a pixel id — very common, it is the easy half — simply
    // does not get one. `skipped` rather than `failed` keeps the distinction an
    // operator needs: nothing is broken, there is just less.
    if (provider === "meta_affiliate") {
      const partner = sendConfigForCode(event.affiliate_code);
      if (!partner) {
        close("skipped", "no_partner_pixel", undefined, 0, 0);
        report.skipped++;
        continue;
      }
      if (!partner.token) {
        close("skipped", "no_partner_token", undefined, 0, 0);
        report.skipped++;
        continue;
      }
      event.__partnerPixel = partner.pixelId;
    }

    if (opts.dryRun) {
      const target =
        provider === "meta" || provider === "meta_affiliate"
          ? buildMetaPayload(event, base)
          : buildGa4Payload(event, base);
      report.previews!.push({ provider, url: target.url, body: target.body });
      report.outcomes.push({
        eventId: row.event_id,
        provider,
        status: "pending",
        reason: "dry_run",
      });
      continue;
    }

    try {
      const response = await deliver(provider, event, base);
      close("sent", undefined, response, Number(row.attempts) + 1, 0);
      report.sent++;
    } catch (err: any) {
      const attempts = Number(row.attempts) + 1;
      const retryable = err instanceof Retryable;
      const exhausted = attempts >= MAX_ATTEMPTS;

      if (!retryable || exhausted) {
        close(
          "failed",
          String(err?.message || err).slice(0, 300),
          undefined,
          attempts,
          0,
        );
        report.failed++;
      } else {
        const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
        close(
          "pending",
          String(err?.message || err).slice(0, 300),
          undefined,
          attempts,
          now + wait,
        );
        report.retried++;
      }
    }
  }

  // Close out the events this pass finished with.
  //
  // `dispatched_at` means "nothing is owed for this event any more", which is a
  // fact about its delivery rows rather than about any single send. Computing it
  // from the rows is what keeps it true when one provider succeeded and the
  // other is still retrying — the case that would otherwise mark an event done
  // while half of it had never been sent.
  if (!opts.dryRun) {
    for (const id of new Set(report.outcomes.map((o) => o.eventId))) {
      const owed = db
        .prepare(
          `SELECT COUNT(*) AS n FROM conversion_deliveries
            WHERE event_id = ? AND status = 'pending'`,
        )
        .get(id) as { n: number };
      if (!owed?.n)
        db.prepare(
          `UPDATE conversion_events SET dispatched_at = ? WHERE event_id = ? AND dispatched_at IS NULL`,
        ).run(now, id);
    }
  }

  return report;
}

/**
 * Email domains that only ever belong to test fixtures.
 *
 * Matched as SUFFIXES, so any future suite using `@something.local` is covered
 * without anyone remembering to add it here.
 *
 * `.local` is a reserved mDNS TLD and can never be a routable address, which is
 * why every suite in this repo uses it. `example.*` are reserved by RFC 2606 for
 * documentation and can never be registered.
 *
 * None of these can exist in production, so refusing to send for them costs
 * nothing real.
 */
const FIXTURE_DOMAINS = [".local", "example.com", "example.org", "example.net"];

/**
 * Does this event belong to a test fixture?
 *
 * Returns false for an unknown or absent user — a real customer we cannot
 * resolve must not be silently dropped, and an event with no user at all is
 * still a legitimate conversion.
 */
export function isFixtureUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const row = db
    .prepare(`SELECT email FROM users WHERE id = ?`)
    .get(affiliateUserId(String(userId))) as { email?: string } | undefined;
  const email = String(row?.email || "").toLowerCase();
  if (!email) return false;
  return FIXTURE_DOMAINS.some((d) => email.endsWith(d));
}

/** What is owed, by provider and status. Read-only, for the console. */
export function deliverySummary() {
  return db
    .prepare(
      `SELECT provider, status, COUNT(*) AS n
         FROM conversion_deliveries
        GROUP BY provider, status
        ORDER BY provider, status`,
    )
    .all() as Array<{ provider: string; status: string; n: number }>;
}

/**
 * Put failed and skipped deliveries back in the queue.
 *
 * `failed` is terminal by design, so a fix at the provider end — a rotated
 * token, a wrong pixel id — would otherwise leave those conversions stranded
 * with no way to retry them short of editing the database.
 *
 * The `attempts` counter is reset with them. Leaving it at the cap would mean
 * the very next attempt gives up immediately, which would look exactly like the
 * requeue having done nothing.
 *
 * `skipped` is included because a skip caused by a missing credential is worth
 * revisiting once credentials exist. A skip caused by refused consent will
 * simply be skipped again the next time this runs.
 */
export function requeueDeliveries(now = Date.now()) {
  const res = db
    .prepare(
      `UPDATE conversion_deliveries
          SET status = 'pending', attempts = 0, next_attempt_at = ?,
              last_error = NULL, response = NULL, delivered_at = NULL
        WHERE status IN ('failed', 'skipped')`,
    )
    .run(now);
  return Number(res.changes || 0);
}
