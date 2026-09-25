import { NextRequest, NextResponse } from "next/server";
import {
  hasUpstox,
  setRuntimeToken,
  upstoxCandles,
  upstoxIntradayCandles,
  resolveUpstoxKey,
} from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";

// Timeframe map: UI -> Upstox interval + fetch window + aggregation.
const TF: Record<string, { up: string; days: number; bucketMin: number }> = {
  "1m": { up: "1minute", days: 5, bucketMin: 1 },
  "5m": { up: "1minute", days: 10, bucketMin: 5 },
  "15m": { up: "1minute", days: 20, bucketMin: 15 },
  day: { up: "day", days: 365, bucketMin: 0 },
  week: { up: "week", days: 1095, bucketMin: 0 },
};

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

// Completed candles never change, so history can sit in cache for minutes.
// Only the current session is live. Caching the two together made every expiry
// pay for the whole history again (~4s for the 1m window).
const HIST_TTL_MS = 5 * 60_000;
// The live half must be finer than the client's post-rollover reconciliation
// delay (6s), otherwise that fetch would still be holding a batch from before
// the new bucket opened and could not correct the candle's open.
const INTRA_TTL_MS = 5_000;

/** Epoch seconds of IST midnight for an IST calendar date. */
const istMidnightSec = (y: number, mo: number, d: number) =>
  Math.floor(Date.UTC(y, mo, d) / 1000 - IST_OFFSET_MS / 1000);

/**
 * The bar period an instant belongs to, matching how Upstox stamps bars:
 * daily bars at IST midnight, weekly bars at the Monday IST midnight (verified:
 * every weekly row lands on a Monday). A UTC midnight would be 5h30m out and
 * never line up with an existing bar.
 */
function periodStartSec(interval: string, ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  if (interval === "week") {
    const sinceMonday = (d.getUTCDay() + 6) % 7; // 0 = Monday
    return istMidnightSec(y, mo, day - sinceMonday);
  }
  return istMidnightSec(y, mo, day);
}

// Upstox hands back candles newest-first. Every step below -- dedupe, merge,
// bucketise, the today-bar synthesis -- assumes oldest-first, so normalise once
// at the door instead of relying on each consumer to remember.
function ascending(rows: any[] = []) {
  return rows
    .map((r) => ({ r, t: Date.parse(r?.[0]) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.r);
}

/** Later rows win, so pass the fresher source last. */
function dedupe(rows: any[]) {
  const by = new Map<number, any>();
  for (const r of rows) {
    const t = Date.parse(r?.[0]);
    if (Number.isFinite(t)) by.set(t, r);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/**
 * Fold the current session's 1-minute bars into a single OHLC bar.
 * The historical endpoint stops at the previous session, and its `day`/`week`
 * intervals cannot be asked for today either, so without this the default Day
 * chart never shows the current day at all.
 * The intraday endpoint only ever returns today, so every row belongs here.
 */
function foldSession(intraAsc: any[]) {
  const rows = intraAsc
    .map((r) => ({
      ts: Date.parse(r?.[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5] ?? 0),
    }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.c) && r.c > 0)
    .sort((a, b) => a.ts - b.ts);
  if (!rows.length) return null;
  return {
    open: rows[0].o,
    high: Math.max(...rows.map((r) => r.h)),
    low: Math.min(...rows.map((r) => r.l)),
    close: rows[rows.length - 1].c,
    volume: rows.reduce((a, r) => a + r.v, 0),
  };
}

/** Upstox row -> lightweight-charts row. */
const toRow = (c: any[]) => ({
  time: Math.floor(Date.parse(c[0]) / 1000),
  open: Number(c[1]),
  high: Number(c[2]),
  low: Number(c[3]),
  close: Number(c[4]),
  volume: Number(c[5] ?? 0),
});

function bucketize(rows: any[], mins: number) {
  // Sorting is not optional on this path: `bucketMin` is 1 for 1m and 0 for
  // day/week, so three of the five timeframes used to return whatever order
  // Upstox sent (newest-first), reversing the chart.
  if (!mins || mins <= 1) return ascending(rows);
  const sec = mins * 60;
  const map = new Map<number, any[]>();
  for (const c of rows) {
    const t = Math.floor(Date.parse(c[0]) / 1000);
    const b = Math.floor(t / sec) * sec;
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(c);
  }
  const out: any[][] = [];
  for (const [b, grp] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const opens = grp.map((g: any[]) => Number(g[1]));
    const highs = grp.map((g: any[]) => Number(g[2]));
    const lows = grp.map((g: any[]) => Number(g[3]));
    const closes = grp.map((g: any[]) => Number(g[4]));
    const vols = grp.map((g: any[]) => Number(g[5] ?? 0));
    out.push([
      new Date(b * 1000).toISOString(),
      opens[0],
      Math.max(...highs),
      Math.min(...lows),
      closes[closes.length - 1],
      vols.reduce((a: number, v: number) => a + v, 0),
      0,
    ]);
  }
  return out;
}

// Cold data: one Upstox candle fetch per symbol+interval per 60s for all users.
export async function POST(req: NextRequest) {
  const { symbol = "NIFTY", interval = "day" } = await req
    .json()
    .catch(() => ({}) as any);
  const sym = String(symbol).toUpperCase();
  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { error: "Maintenance", candles: [], source: "none" },
      { status: 503 },
    );
  const win = rs.candleWindows?.[String(interval)] as
    | { days: number; bucketMin: number }
    | undefined;
  const tf = win
    ? {
        up: (TF[String(interval)] ?? TF.day).up,
        days: win.days,
        bucketMin: win.bucketMin,
      }
    : (TF[String(interval)] ?? TF.day);
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      { error: "Set UPSTOX_ANALYTICS_TOKEN", candles: [], source: "none" },
      { status: 412 },
    );
  try {
    // Completed history and the current session are cached separately, because
    // they have completely different volatility. Caching them as one entry
    // meant every expiry re-fetched the lot: the 1m window is five days of
    // minute bars and took ~4s, which the chart then had to wait on.
    //
    // History is finished sessions only -- it cannot change -- so it can sit
    // for minutes. Only today is live, and that fetch is small.
    const hist = await cached(
      `candles-hist:${sym}:${interval}`,
      HIST_TTL_MS,
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - tf.days * 864e5)
          .toISOString()
          .slice(0, 10);
        const key = await resolveUpstoxKey(sym);
        return ascending(await upstoxCandles(key, tf.up, today, from));
      },
      // Same reasoning as the history cache above: the chart fetches once, so
      // it must not be handed a stale series.
      { swr: false },
    );

    const agg = tf.bucketMin > 0;
    // The intraday endpoint takes no date range and is always 1-minute, so one
    // cache entry serves every timeframe. The operator's `ttl.candles` can
    // shorten this, but not lengthen it: its 60s default is tuned for a whole
    // candle series, and a live bucket needs seconds. History stays a constant,
    // because completed sessions cannot change however short the poll is.
    const intra = await cached(
      `candles-intra:${sym}`,
      Math.min(rs.ttl.candles || INTRA_TTL_MS, INTRA_TTL_MS),
      async () => {
        const key = await resolveUpstoxKey(sym);
        try {
          return ascending(await upstoxIntradayCandles(key, "1minute"));
        } catch {
          // Best effort: without it the chart still renders history.
          return [] as any[];
        }
      },
      { swr: false },
    );

    const histRows = hist.data;
    const intraRows = intra.data;

    // Intraday charts stitch today's bars onto history, then bucketise the lot
    // so 5m/15m buckets spanning the session boundary stay aligned.
    const candles = agg
      ? bucketize(dedupe([...histRows, ...intraRows]), tf.bucketMin).map(toRow)
      : (() => {
          // day/week: one bar per calendar period. If the last bar already IS
          // the current period, extend it with today's session. Upstox ships
          // the forming weekly bar, so appending instead would leave two bars
          // in one week -- and the new one would sit on today's weekday rather
          // than the Monday every other weekly bar uses.
          const todayPeriod = periodStartSec(String(interval), Date.now());
          const lastPeriod = histRows.length
            ? periodStartSec(
                String(interval),
                Date.parse(histRows[histRows.length - 1][0]),
              )
            : 0;
          const session = foldSession(intraRows);
          let out = histRows;
          if (session && histRows.length && todayPeriod === lastPeriod) {
            const last = histRows[histRows.length - 1];
            out = [
              ...histRows.slice(0, -1),
              [
                last[0],
                Number(last[1]), // the period's own open, not today's
                Math.max(Number(last[2]), session.high),
                Math.min(Number(last[3]), session.low),
                session.close,
                Number(last[5] ?? 0) + session.volume,
                0,
              ],
            ];
          } else if (session && todayPeriod > lastPeriod) {
            out = [
              ...histRows,
              [
                new Date(todayPeriod * 1000).toISOString(),
                session.open,
                session.high,
                session.low,
                session.close,
                session.volume,
                0,
              ],
            ];
          }
          return out.map(toRow);
        })();

    return NextResponse.json({
      candles,
      source: "upstox",
      cached: hist.cached && intra.cached,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "candles failed", candles: [], source: "none" },
      { status: 502 },
    );
  }
}
