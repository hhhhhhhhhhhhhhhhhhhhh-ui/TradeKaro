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
      if (t < s.start) return "PRE";
      if (t <= s.end) return "LIVE";
      return "POST";
    }
  }

  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (mins < toMins(cfg?.open || "09:15", 555)) return "PRE";
  if (mins <= toMins(cfg?.close || "15:30", 930)) return "LIVE";
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

function closedReason(
  cfg: MarketHours | undefined,
  phase: MarketPhase,
  segment: ExchangeCode = EQUITY_EXCHANGE,
) {
  const open = cfg?.open || "09:15";
  const close = cfg?.close || "15:30";
  const name = EXCHANGE_LABEL[segment];
  switch (phase) {
    case "WEEKEND":
      return `Market closed for the weekend — ${name} trades Mon–Fri, ${open}–${close} IST.`;
    case "HOLIDAY":
      return `${name} is closed for a trading holiday today.`;
    case "PRE":
      return `${name} has not opened yet — today's session starts at ${open} IST.`;
    default:
      return `${name} is closed — today's session ended at ${close} IST.`;
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
  return { allowed: false, phase, reason: closedReason(cfg, phase, segment) };
}
