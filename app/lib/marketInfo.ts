import { promises as fs } from "node:fs";
import path from "node:path";
import { upstoxGet } from "./upstox";
import type { DayCalendar, ExchangeCode, SessionWindow } from "./marketClock";

// ── Exchange calendar ───────────────────────────────────────────────────────
//
// Holidays and session timings straight from the provider, because the manual
// list this replaces could only ever be wrong in the quiet direction: an
// unlisted holiday silently let orders through and let the MIS square-off fire
// on a day the exchange was shut.
//
// Both calls are cached hard — holidays for 12 hours, timings for 1 hour — so
// the whole platform costs a handful of requests a day against a 500/min
// allowance.
//
// ── Why per-exchange matters ────────────────────────────────────────────────
// The holiday feed is NOT a flat list of closed days. A single date can carry
// `closed_exchanges: ["MCX","CDS","BCD"]` while NSE trades normally. One shared
// holiday flag would therefore be wrong for commodities in one direction and
// wrong for equities in the other.
//
// Every read here fails SOFT: if the provider is unreachable or the token has
// lapsed, callers get `null` and fall back to the admin-configured window. The
// trading gate must never depend on a network call succeeding.

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_F = path.join(CACHE_DIR, "market-calendar.json");

const HOLIDAY_TTL_MS = 12 * 60 * 60 * 1000;
const TIMING_TTL_MS = 60 * 60 * 1000;

/**
 * Exchange codes exactly as the provider returns them.
 *
 * Verified live: `/market/timings/2026-09-17` returns all eight. Note `NSCOM`
 * (NSE's commodity segment) and `NFO` (NSE F&O) are separate from `NSE` and
 * carry different hours — NFO runs to 15:40, NSCOM and MCX to 23:30.
 *
 * The codes are returned bare and unquoted. Guessing them would have been
 * wrong: `NSCOM` is not `NSE_COM`, and there is no `NSE_FO` code at all.
 *
 * The type itself lives in `marketClock.ts` because that is the module the
 * client bundle is allowed to import; this one reaches `node:fs`.
 */
type Exchange = ExchangeCode;

/** One day's closures and sessions, as stored internally. */
type DayEntry = {
  /** YYYY-MM-DD in IST. */
  date: string;
  /** Exchanges shut for the whole day. */
  closed: Exchange[];
  /** Per-exchange sessions, epoch ms. Empty when closed. */
  open: Partial<Record<Exchange, SessionWindow>>;
  description?: string;
};

type Cache = {
  holidaysAt: number;
  holidaysYear: number;
  /** date -> calendar entry */
  days: Record<string, DayEntry>;
  timingsAt: number;
  /** date -> exchange -> window */
  timings: Record<string, Partial<Record<Exchange, SessionWindow>>>;
};

let mem: Cache | null = null;
let loading: Promise<Cache> | null = null;

const EXCHANGES: Exchange[] = [
  "NSE",
  "NFO",
  "NSCOM",
  "BSE",
  "BFO",
  "MCX",
  "CDS",
  "BCD",
];

function asExchange(v: unknown): Exchange | null {
  const s = String(v || "").toUpperCase() as Exchange;
  return EXCHANGES.includes(s) ? s : null;
}

async function readCache(): Promise<Cache> {
  const empty: Cache = {
    holidaysAt: 0,
    holidaysYear: 0,
    days: {},
    timingsAt: 0,
    timings: {},
  };
  try {
    const raw = await fs.readFile(CACHE_F, "utf8");
    const j = JSON.parse(raw) as Cache;
    return { ...empty, ...j };
  } catch {
    return empty;
  }
}

async function writeCache(c: Cache) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_F, JSON.stringify(c));
  } catch {
    /* disk cache is best-effort */
  }
}

/**
 * Which exchange does an instrument belong to?
 *
 * Derived from the instrument key prefix, which every order already carries
 * (`MCX_FO|...`, `NSE_EQ|...`). This is the only mapping the rest of the app
 * needs — nothing has to hardcode "commodities are special".
 */
export function exchangeOfInstrument(key: string): Exchange {
  const p = String(key || "")
    .toUpperCase()
    .split("|")[0];
  if (p.startsWith("MCX")) return "MCX";
  // NSE's own commodity segment — same late session as MCX, different code.
  if (p === "NSE_COM") return "NSCOM";
  if (p === "NSE_FO") return "NFO";
  if (p.startsWith("NCD")) return "CDS";
  if (p.startsWith("BCD")) return "BCD";
  if (p.startsWith("BSE")) return p.endsWith("_FO") ? "BFO" : "BSE";
  return "NSE";
}

/**
 * Commodity root symbols (GOLD, SILVER, CRUDEOIL…).
 *
 * Populated from the MCX master so this stays the single place that answers
 * "is this a commodity?" — the order gate must not grow a second list.
 */
export const COMMODITY_SYMBOLS = new Set<string>();

/**
 * Which exchange a symbol trades on.
 *
 * Cheap and synchronous on purpose: this sits in the order gate, which runs on
 * every fill, and `validateFill` must not acquire I/O it does not need.
 *
 * Options are NFO, and NFO runs to 15:40 — ten minutes past the NSE cash close.
 * Treating every order as NSE therefore refused the tail of every options
 * session, every day.
 */
export function exchangeOfSymbol(symbol: string, kind?: string): Exchange {
  const s = String(symbol || "").toUpperCase();
  if (COMMODITY_SYMBOLS.has(s)) return "MCX";
  return String(kind || "").toUpperCase() === "OPTION" ? "NFO" : "NSE";
}

/**
 * Cap on a single provider fetch during a refresh.
 *
 * The order gate awaits the calendar, so a provider that accepts a connection
 * and then never answers would hang every order rather than refusing it. Four
 * seconds is far longer than a healthy call and short enough to stay invisible.
 * On timeout the previous cache stands, which callers already treat as
 * "unknown" and fall back from.
 */
const FETCH_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`${label} timed out after ${FETCH_TIMEOUT_MS}ms`)),
        FETCH_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** Upstox wants the date in IST; `toISOString` on a local Date is not that. */
export function istDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function fetchHolidays(year: number, base: Cache): Promise<Cache> {
  const j: any = await withTimeout(upstoxGet("/market/holidays"), "holidays");
  const list: any[] = Array.isArray(j?.data) ? j.data : [];
  const days: Record<string, DayEntry> = { ...base.days };

  for (const h of list) {
    const date = String(h?.date || "").slice(0, 10);
    if (!date) continue;
    const closed = (
      Array.isArray(h?.closed_exchanges) ? h.closed_exchanges : []
    )
      .map(asExchange)
      .filter(Boolean) as Exchange[];
    const open: Partial<Record<Exchange, SessionWindow>> = {};
    for (const o of Array.isArray(h?.open_exchanges) ? h.open_exchanges : []) {
      const ex = asExchange(o?.exchange);
      const start = Number(o?.start_time);
      const end = Number(o?.end_time);
      if (ex && Number.isFinite(start) && Number.isFinite(end))
        open[ex] = { start, end };
    }
    days[date] = {
      date,
      closed,
      open,
      description: String(h?.description || ""),
    };
  }

  return {
    ...base,
    days,
    holidaysAt: Date.now(),
    holidaysYear: year,
  };
}

async function fetchTimings(date: string, base: Cache): Promise<Cache> {
  const j: any = await withTimeout(
    upstoxGet(`/market/timings/${date}`),
    "timings",
  );
  const list: any[] = Array.isArray(j?.data) ? j.data : [];
  const day: Partial<Record<Exchange, SessionWindow>> = {};
  for (const t of list) {
    const ex = asExchange(t?.exchange);
    const start = Number(t?.start_time);
    const end = Number(t?.end_time);
    if (ex && Number.isFinite(start) && Number.isFinite(end))
      day[ex] = { start, end };
  }
  return {
    ...base,
    timings: { ...base.timings, [date]: day },
    timingsAt: Date.now(),
  };
}

/**
 * Refresh whatever has gone stale. Network failures are swallowed on purpose —
 * a stale cache is strictly better than no calendar, and both are better than
 * a trading gate that throws.
 */
async function load(now = new Date()): Promise<Cache> {
  let c = mem ?? (await readCache());
  const date = istDate(now);
  const year = Number(date.slice(0, 4));
  const today = now.getTime();

  try {
    if (
      today - c.holidaysAt > HOLIDAY_TTL_MS ||
      c.holidaysYear !== year ||
      !Object.keys(c.days).length
    ) {
      c = await fetchHolidays(year, c);
    }
  } catch {
    /* keep the previous holidays */
  }

  try {
    if (today - c.timingsAt > TIMING_TTL_MS || !c.timings[date]) {
      c = await fetchTimings(date, c);
    }
  } catch {
    /* keep the previous timings */
  }

  mem = c;
  void writeCache(c);
  return c;
}

/** Serialised so a burst of requests triggers one refresh, not ten. */
async function calendar(now = new Date()): Promise<Cache> {
  if (!loading) {
    loading = load(now).finally(() => {
      loading = null;
    });
  }
  return loading;
}

/**
 * Today's session for one exchange.
 *
 * `null` means "we do not know" — provider unreachable, or no entry for this
 * date — and callers must fall back to the configured window. It never means
 * "closed", because treating an outage as a market closure would silently stop
 * every order.
 */
export async function sessionFor(
  exchange: Exchange,
  now = new Date(),
): Promise<SessionWindow | null> {
  const c = await calendar(now);
  const date = istDate(now);
  const day = c.days[date];

  // A holiday entry is authoritative: if it names this exchange as closed,
  // there is no session today even if a timing row exists.
  if (day?.closed.includes(exchange)) return null;

  const direct = c.timings[date]?.[exchange];
  if (direct) return direct;
  if (day?.open[exchange]) return day.open[exchange]!;
  return null;
}

/**
 * Is this exchange shut for the whole day?
 *
 * Unknown dates answer `false`: an unreachable provider must not be read as a
 * holiday. Erring toward "open" keeps the existing admin window in charge,
 * which is the behaviour every caller already had.
 */
export async function isExchangeClosed(
  exchange: Exchange,
  now = new Date(),
): Promise<boolean> {
  const c = await calendar(now);
  const day = c.days[istDate(now)];
  return Boolean(day?.closed.includes(exchange));
}

/** Every closure this year, for the console to display. */
export async function holidayList(now = new Date()) {
  const c = await calendar(now);
  return Object.values(c.days)
    .filter((d) => d.closed.length)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Today's sessions, keyed by exchange — what the public config ships. */
export async function todaySessions(
  now = new Date(),
): Promise<DayCalendar & { date: string }> {
  const c = await calendar(now);
  const date = istDate(now);
  const day = c.days[date];
  const sessions: Partial<Record<Exchange, SessionWindow>> = {
    ...(c.timings[date] || {}),
    ...(day?.open || {}),
  };
  for (const ex of day?.closed || []) delete sessions[ex];
  return { date, closed: day?.closed || [], sessions };
}
