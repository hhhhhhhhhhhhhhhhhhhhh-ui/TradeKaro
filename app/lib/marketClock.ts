// Shared NSE session clock — one source of truth for "is the market open"
// checks across StatusBar, chart live-candle rolling, and TradeEngine gates.

export type MarketHours = {
  open: string;
  close: string;
  /**
   * @deprecated No longer read. Trading holidays come from the exchange
   * calendar (see `marketInfo.ts`), because a single hand-kept list cannot
   * express that MCX stays open on days NSE is shut. Kept so settings written
   * by older builds still parse.
   */
  holidays?: string[];
};

export type MarketPhase = "WEEKEND" | "HOLIDAY" | "PRE" | "LIVE" | "POST";

/**
 * Exchange codes exactly as the provider returns them.
 *
 * Verified live against `/market/timings`. They are not guessable from the
 * instrument-key prefixes: there is no `NSE_FO` code (`NFO` instead), and NSE's
 * commodity segment is `NSCOM`, not `NSE_COM`.
 *
 * Declared here rather than in `marketInfo.ts` on purpose — this module is
 * imported by client components, and `marketInfo` pulls in `node:fs`.
 */
export type ExchangeCode =
  | "NSE"
  | "NFO"
  | "NSCOM"
  | "BSE"
  | "BFO"
  | "MCX"
  | "CDS"
  | "BCD";

/** Cash equities are the default segment everywhere. */
export const EQUITY_EXCHANGE: ExchangeCode = "NSE";

export type SessionWindow = { start: number; end: number };

/**
 * Today's exchange calendar, fetched server-side and handed to both the client
 * and the order gate so they cannot disagree.
 *
 * `null`/absent means "unknown" — provider unreachable, or no data yet — and
 * every reader falls back to the admin window. It must never be read as
 * "closed": treating an outage as a market closure would silently stop every
 * order on the platform.
 */
export type DayCalendar = {
  /** Exchanges shut for the whole day. */
  closed: ExchangeCode[];
  /** Per-exchange sessions in epoch ms, for exchanges that are open. */
  sessions: Partial<Record<ExchangeCode, SessionWindow>>;
};

/** Friendly names for operator- and customer-facing copy. */
export const EXCHANGE_LABEL: Record<ExchangeCode, string> = {
  NSE: "NSE",
  NFO: "NSE F&O",
  NSCOM: "NSE Commodities",
  BSE: "BSE",
  BFO: "BSE F&O",
  MCX: "MCX",
  CDS: "Currency",
  BCD: "Currency",
};

/**
 * Normal session end for each segment, `HH:MM` IST.
 *
 * A fallback only — the provider calendar overrides it whenever it is
 * available. It exists because one admin window cannot describe the real day,
 * and the MIS square-off needs to know when a leg's OWN market closes. Squaring
 * everything off at the cash-equity close flattened gold eight hours early.
 *
 * Calibrated against live `/market/timings`: NSE 15:30, NFO 15:40, MCX and
 * NSE Commodities 23:30, currency 17:00.
 */
export const SEGMENT_CLOSE_FALLBACK: Record<ExchangeCode, string> = {
  NSE: "15:30",
  NFO: "15:40",
  NSCOM: "23:30",
  BSE: "15:30",
  BFO: "15:40",
  MCX: "23:30",
  CDS: "17:00",
  BCD: "17:00",
};

/** Opening bell per segment, `HH:MM` IST. Companion to the close times above. */
export const SEGMENT_OPEN_FALLBACK: Record<ExchangeCode, string> = {
  NSE: "09:15",
  NFO: "09:15",
  NSCOM: "09:00",
  BSE: "09:15",
  BFO: "09:15",
  MCX: "09:00",
  CDS: "09:00",
  BCD: "09:00",
};

/**
 * Session hours to use when the provider calendar is unavailable.
 *
 * The admin window is honoured for cash equities — that is what the two fields
 * describe — and ONLY for those. Every other segment has its own documented
 * hours, and applying the equity window to them is how MCX came out closed for
 * the whole evening session, which is the only time commodities trade on their
 * own. An unreachable provider must never look like a market closure.
 */
export function segmentFallbackHours(
  cfg: MarketHours | undefined,
  segment: ExchangeCode = EQUITY_EXCHANGE,
): { open: string; close: string } {
  if (segment === EQUITY_EXCHANGE)
    return { open: cfg?.open || "09:15", close: cfg?.close || "15:30" };
  return {
    open: SEGMENT_OPEN_FALLBACK[segment] ?? "09:15",
    close: SEGMENT_CLOSE_FALLBACK[segment] ?? "15:30",
  };
}

/**
 * How long before the open the market counts as PRE-OPEN rather than closed.
 *
 * Without a bound, every hour between midnight and the opening bell reported
 * PRE-OPEN — including 01:00, which is closer to the previous close than to the
 * next open.
 */
export const PRE_OPEN_WINDOW_MINS = 90;

/**
 * Does this segment trade the late commodities session?
 *
 * MCX and NSE's commodity segment share hours far outside the cash market, so
 * they need their own cutoffs and their own lot rules.
 */
export function isCommoditySegment(segment: ExchangeCode): boolean {
  return segment === "MCX" || segment === "NSCOM";
}

function toMins(hhmm: string, fb: number) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : fb;
}

export function istYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function marketPhase(
  cfg: MarketHours | undefined,
  now = new Date(),
): MarketPhase {
  return segmentPhase(cfg, now, EQUITY_EXCHANGE, null);
}

/**
 * Session state for ONE exchange.
 *
 * The provider calendar wins when we have it. Without one we fall back to the
 * admin-configured window and a weekday check — deliberately NOT to a holiday
 * list, because a manual list is exactly the thing this replaced: it can only be
 * wrong in the quiet direction, letting orders through on a day the exchange is
 * shut.
 *
 * Segments differ more than people expect. Measured live:
 *   NSE 09:15-15:30 · NFO 09:15-15:40 · NSCOM and MCX 09:00-23:30
 * so a single window is wrong for options by 10 minutes and for commodities by
 * eight hours.
 */
export function segmentPhase(
  cfg: MarketHours | undefined,
  now: Date,
  segment: ExchangeCode,
  cal?: DayCalendar | null,
): MarketPhase {
  const ist = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const day = ist.getDay();
  if (day === 0 || day === 6) return "WEEKEND";

  if (cal) {
    if (cal.closed.includes(segment)) return "HOLIDAY";
    const s = cal.sessions[segment];
    if (s) {
      const t = now.getTime();
      // PRE is bounded by the same window as the fallback below. A bare
      // `t < s.start` is true from midnight — all night and most of the morning
      // — so this path reported PRE-OPEN at 03:00, telling a customer the
      // session was about to begin six hours before it was. The fallback branch
      // was fixed without this one, and the difference was invisible until a
      // calendar was actually available: every local test passed `cal = null`
      // and took the other path.
      if (t < s.start)
        return s.start - t <= PRE_OPEN_WINDOW_MINS * 60_000 ? "PRE" : "POST";
      if (t <= s.end) return "LIVE";
      return "POST";
    }
  }

  // No calendar: fall back PER SEGMENT. Using the single admin window here
  // judged MCX against cash-equity hours, so the evening session looked shut
  // whenever the provider was unreachable — a fallback that reads as "closed"
  // is the one thing a fallback must never do.
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const hours = segmentFallbackHours(cfg, segment);
  const openMins = toMins(hours.open, 555);
  // PRE only within the run-up to the open. Before that the market is not
  // waiting to start — it is SHUT, and it shut yesterday. A bare `mins < open`
  // reported PRE-OPEN at 01:00 IST, telling a customer the session was about to
  // begin when it was eight hours away.
  if (mins < openMins)
    return openMins - mins <= PRE_OPEN_WINDOW_MINS ? "PRE" : "POST";
  if (mins <= toMins(hours.close, 930)) return "LIVE";
  return "POST";
}

/**
 * Epoch ms for a `HH:MM` IST wall-clock time on the IST date of `now`.
 *
 * India has no DST, so IST is a fixed +05:30 — the conversion is a constant
 * offset rather than a timezone lookup. Used to pin the MIS square-off to a real
 * instant, so a sweep that runs late can still stamp its fill with the time it
 * was supposed to happen.
 */
export function istInstant(now: Date, hhmm: string): number {
  const ist = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const [hh, mm] = String(hhmm || "")
    .split(":")
    .map((x) => parseInt(x, 10));
  const h = Number.isFinite(hh) ? hh : 15;
  const m = Number.isFinite(mm) ? mm : 15;
  return (
    Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate(), h, m) -
    5.5 * 3600_000
  );
}

/** IST minutes-since-midnight, for comparing against a HH:MM cutoff. */
export function istMinutes(now = new Date()): number {
  const ist = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  return ist.getHours() * 60 + ist.getMinutes();
}

/** IST `HH:MM` for an epoch instant. India has no DST, so this is a constant shift. */
function istHhmm(ms: number): string {
  const d = new Date(ms + 5.5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * `HH:MM` moved back by `mins`, wrapping at midnight.
 *
 * The square-off cutoff has to land INSIDE the session — an exit priced at the
 * exact close has nothing to price against — so commodity cutoffs are derived
 * from the session end rather than pinned to a fixed time.
 */
export function shiftHhmm(hhmm: string, mins: number): string {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ""));
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 930;
  const t = (((base + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(
    t % 60,
  ).padStart(2, "0")}`;
}

/**
 * When this segment's session ends today, as `HH:MM` IST.
 *
 * The provider calendar wins when we have it. Without one, the segment's own
 * fallback — deliberately NOT the admin window, which describes cash equities
 * and would put the MCX close at 15:30.
 */
export function segmentClose(
  cfg: MarketHours | undefined,
  now: Date,
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): string {
  const s = cal?.sessions?.[segment];
  if (s) return istHhmm(s.end);
  return segmentFallbackHours(cfg, segment).close;
}

/** When this segment's session starts today, as `HH:MM` IST. */
export function segmentOpen(
  cfg: MarketHours | undefined,
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): string {
  const s = cal?.sessions?.[segment];
  if (s) return istHhmm(s.start);
  return segmentFallbackHours(cfg, segment).open;
}

/**
 * When new intraday legs stop being accepted for one segment, `HH:MM` IST.
 *
 * This is the ONE definition. The order gate, the MIS square-off sweep and the
 * customer-facing countdown all call it, and they have to agree — a notice
 * promising 15:15 while the sweep closes at 23:25 is worse than no notice at
 * all, and a gate that allows a leg the sweep is about to flatten books a
 * phantom round trip. It lives here rather than beside the sweep because the
 * browser needs it too and cannot import the server module.
 *
 * Equities use the operator's configured cutoff (15:15 by default, deliberately
 * before the 15:30 close so the exit still has a market to price against).
 * Commodities derive theirs from their OWN session end: MCX runs to 23:30, so an
 * inherited 15:15 would stop accepting gold legs at lunchtime and flatten open
 * ones while the exchange was still trading.
 */
export function misCutoff(
  cfg: MarketHours | undefined,
  adminCutoff: string | undefined,
  now: Date,
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): string {
  if (isCommoditySegment(segment))
    return shiftHhmm(segmentClose(cfg, now, segment, cal), -5);
  return adminCutoff || "15:15";
}

export function isMarketLive(
  cfg: MarketHours | undefined,
  now = new Date(),
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): boolean {
  return segmentPhase(cfg, now, segment, cal) === "LIVE";
}

export function marketStatusLabel(
  cfg: MarketHours | undefined,
  now = new Date(),
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): string {
  switch (segmentPhase(cfg, now, segment, cal)) {
    case "WEEKEND":
      return "CLOSED · WEEKEND";
    case "HOLIDAY":
      return `CLOSED · ${EXCHANGE_LABEL[segment]} HOLIDAY`;
    case "PRE":
      return "PRE-OPEN";
    case "LIVE":
      return `LIVE · ${EXCHANGE_LABEL[segment]} OPEN`;
    default:
      return "CLOSED · POST-MARKET";
  }
}

/**
 * The segments the platform actually trades, in the order the chrome should
 * prefer them. Cash first because it is what most customers mean by "the market".
 */
export const TRADED_SEGMENTS: ExchangeCode[] = [
  EQUITY_EXCHANGE,
  "NFO",
  "MCX",
  "NSCOM",
];

/**
 * Session status across every market we trade, for the global status chrome.
 *
 * The navbar, footer and dashboard row all asked about NSE alone. Most of the
 * working day that is fine, but from 15:30 to 23:30 they told the whole platform
 * "CLOSED · POST-MARKET" while MCX was open — so a customer holding live gold
 * was told the market was shut, on the same screen showing the position.
 *
 * A single tag cannot describe four exchanges, so it names the one that is
 * open, preferring cash when cash is open. Only when nothing is open does it
 * fall back to reporting the primary market's reason.
 */
export function broadMarketStatus(
  cfg: MarketHours | undefined,
  now = new Date(),
  cal?: DayCalendar | null,
): { label: string; live: boolean; segments: ExchangeCode[] } {
  const live = TRADED_SEGMENTS.filter(
    (s) => segmentPhase(cfg, now, s, cal) === "LIVE",
  );
  if (live.length) {
    const lead = live.includes(EQUITY_EXCHANGE) ? EQUITY_EXCHANGE : live[0];
    return {
      label: `LIVE · ${EXCHANGE_LABEL[lead]} OPEN`,
      live: true,
      segments: live,
    };
  }
  return {
    label: marketStatusLabel(cfg, now, EQUITY_EXCHANGE, cal),
    live: false,
    segments: [],
  };
}

function closedReason(
  cfg: MarketHours | undefined,
  phase: MarketPhase,
  segment: ExchangeCode = EQUITY_EXCHANGE,
  now: Date = new Date(),
  cal?: DayCalendar | null,
) {
  // The message has to name THIS segment's hours. It used to print the admin
  // window whatever the segment was, so a refusal at 23:38 told a commodity
  // customer the market "ended at 15:30" — true of NSE, eight hours off for MCX,
  // and a good way to make a correct refusal look like a broken clock.
  const open = segmentOpen(cfg, segment, cal);
  const close = segmentClose(cfg, now, segment, cal);
  const name = EXCHANGE_LABEL[segment];
  switch (phase) {
    case "WEEKEND":
      return `Market closed for the weekend — ${name} trades Mon–Fri, ${open}–${close} IST.`;
    case "HOLIDAY":
      return `${name} is closed for a trading holiday today.`;
    case "PRE":
      return `${name} has not opened yet — today's session starts at ${open} IST.`;
    default: {
      // POST covers two different situations: the evening after a close, and the
      // small hours before the next open. Naming the wrong one is how the status
      // bar ended up saying "ended at 15:30" at one in the morning.
      return istMinutes(now) < toMins(open, 555)
        ? `${name} is closed — today's session opens at ${open} IST.`
        : `${name} is closed — today's session ended at ${close} IST.`;
    }
  }
}

/**
 * Whether an order may be placed right now, for one exchange segment.
 *
 * This is the single guard behind both the order-button state and the
 * authoritative server check, so the browser and the ledger can never disagree
 * about whether the session is open.
 *
 * `allowAfterHours` is the admin's deliberate escape hatch: the platform runs on
 * live market data, so without it the app would be untradeable every evening and
 * all weekend — including for whoever is demonstrating it.
 */
export function orderWindow(
  cfg: MarketHours | undefined,
  allowAfterHours = false,
  now = new Date(),
  segment: ExchangeCode = EQUITY_EXCHANGE,
  cal?: DayCalendar | null,
): { allowed: boolean; phase: MarketPhase; reason: string } {
  const phase = segmentPhase(cfg, now, segment, cal);
  if (phase === "LIVE" || allowAfterHours)
    return { allowed: true, phase, reason: "" };
  return {
    allowed: false,
    phase,
    reason: closedReason(cfg, phase, segment, now, cal),
  };
}
