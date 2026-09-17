// Shared NSE session clock — one source of truth for "is the market open"
// checks across StatusBar, chart live-candle rolling, and TradeEngine gates.

export type MarketHours = {
  open: string;
  close: string;
  holidays?: string[];
};

export type MarketPhase = "WEEKEND" | "HOLIDAY" | "PRE" | "LIVE" | "POST";

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
  // NSE cash hours follow the admin panel (default 09:15–15:30 IST Mon–Fri).
  const ist = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  if (day === 0 || day === 6) return "WEEKEND";
  if (cfg?.holidays?.includes(istYmd(ist))) return "HOLIDAY";
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
): boolean {
  return marketPhase(cfg, now) === "LIVE";
}

export function marketStatusLabel(
  cfg: MarketHours | undefined,
  now = new Date(),
): string {
  switch (marketPhase(cfg, now)) {
    case "WEEKEND":
      return "CLOSED · WEEKEND";
    case "HOLIDAY":
      return "CLOSED · HOLIDAY";
    case "PRE":
      return "PRE-OPEN";
    case "LIVE":
      return "LIVE · NSE OPEN";
    default:
      return "CLOSED · POST-MARKET";
  }
}

function closedReason(cfg: MarketHours | undefined, phase: MarketPhase) {
  const open = cfg?.open || "09:15";
  const close = cfg?.close || "15:30";
  switch (phase) {
    case "WEEKEND":
      return `Market closed for the weekend — NSE trades Mon–Fri, ${open}–${close} IST.`;
    case "HOLIDAY":
      return `Market closed for a trading holiday — NSE trades Mon–Fri, ${open}–${close} IST.`;
    case "PRE":
      return `Market has not opened yet — today's session starts at ${open} IST.`;
    default:
      return `Market closed — today's session ended at ${close} IST.`;
  }
}

/**
 * Whether an order may be placed right now.
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
): { allowed: boolean; phase: MarketPhase; reason: string } {
  const phase = marketPhase(cfg, now);
  if (phase === "LIVE" || allowAfterHours)
    return { allowed: true, phase, reason: "" };
  return { allowed: false, phase, reason: closedReason(cfg, phase) };
}
