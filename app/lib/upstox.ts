const BASE = "https://api.upstox.com/v2";

const ENV_TOKEN =
  process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN || "";

export const UPSTOX_TOKEN = ENV_TOKEN;

// Admin panel can rotate the token without a redeploy; env stays fallback.
let runtimeToken = "";
export function setRuntimeToken(t: string) {
  runtimeToken = t || "";
}
function activeToken() {
  return runtimeToken || ENV_TOKEN;
}

export const hasUpstox = () => Boolean(activeToken());

// Instrument keys as Upstox expects them. Indices use names,
// NSE equities use ISINs (ticker form like NSE_EQ|RELIANCE is rejected).
export const UPSTOX_MAP: Record<string, string> = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  SENSEX: "BSE_INDEX|SENSEX",
  RELIANCE: "NSE_EQ|INE002A01018",
  TCS: "NSE_EQ|INE467B01029",
  INFY: "NSE_EQ|INE009A01021",
  HDFCBANK: "NSE_EQ|INE040A01034",
  SBIN: "NSE_EQ|INE062A01020",
  TATAMOTORS: "NSE_EQ|INE155A01022",
  ICICIBANK: "NSE_EQ|INE090A01021",
  WIPRO: "NSE_EQ|INE075A01022",
  BAJFINANCE: "NSE_EQ|INE296A01024",
  SUNPHARMA: "NSE_EQ|INE044A01036",
  ADANIENT: "NSE_EQ|INE423A01024",
  MARUTI: "NSE_EQ|INE585B01010",
  AXISBANK: "NSE_EQ|INE238A01034",
  HCLTECH: "NSE_EQ|INE860A01027",
  NESTLEIND: "NSE_EQ|INE239A01016",
  LTIM: "NSE_EQ|INE214T01019",
  POWERGRID: "NSE_EQ|INE752E01010",
  HDFCLIFE: "NSE_EQ|INE795G01014",
};

export const upstoxKey = (sym: string) =>
  UPSTOX_MAP[String(sym).toUpperCase()] ??
  `NSE_EQ|${String(sym).toUpperCase()}`;

function headers() {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${activeToken()}`,
  };
}

// ── Rate limit + circuit breaker ──
// Upstox rejects bursts (429). Keep a small in-process token bucket and
// short-circuit upstream calls for a cooldown after repeated failures so
// every client request doesn't hammer a dead/limited provider.
const LIMIT_PER_SEC = 8;
const LIMIT_PER_MIN = 240;
let secWindow: number[] = [];
let minWindow: number[] = [];
let circuitOpenUntil = 0;
let consecutiveFails = 0;

export const providerHealth = {
  state: "ok" as "ok" | "degraded" | "down",
  lastOkAt: 0,
  lastErrorAt: 0,
  lastError: "",
  totalCalls: 0,
  total429: 0,
};

function prune(now: number) {
  if (secWindow.length > 64)
    secWindow = secWindow.filter((t) => now - t < 1000);
  if (minWindow.length > 512)
    minWindow = minWindow.filter((t) => now - t < 60000);
}

async function acquireSlot() {
  for (;;) {
    const now = Date.now();
    prune(now);
    secWindow = secWindow.filter((t) => now - t < 1000);
    minWindow = minWindow.filter((t) => now - t < 60000);
    const secWait =
      secWindow.length >= LIMIT_PER_SEC ? 1000 - (now - secWindow[0]) : 0;
    const minWait =
      minWindow.length >= LIMIT_PER_MIN ? 60000 - (now - minWindow[0]) : 0;
    const wait = Math.max(secWait, minWait);
    if (wait <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(wait + 10, 1000)));
  }
  const t = Date.now();
  secWindow.push(t);
  minWindow.push(t);
}

async function get(path: string) {
  if (Date.now() < circuitOpenUntil) {
    const s = Math.ceil((circuitOpenUntil - Date.now()) / 1000);
    throw new Error(`upstox circuit open (${s}s)`);
  }
  await acquireSlot();
  providerHealth.totalCalls += 1;
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      headers: headers(),
      cache: "no-store",
    });
  } catch (e: any) {
    consecutiveFails += 1;
    tripBreaker(e?.message || "network error");
    throw e;
  }
  if (r.status === 429) {
    providerHealth.total429 += 1;
    const retry = Number(r.headers.get("retry-after")) || 5;
    consecutiveFails += 1;
    tripBreaker("upstox 429 rate limited");
    await new Promise((res) => setTimeout(res, Math.min(retry, 30) * 1000));
    throw new Error("upstox 429 rate limited");
  }
  if (!r.ok) {
    consecutiveFails += 1;
    providerHealth.lastError = `upstox ${path} ${r.status}`;
    providerHealth.lastErrorAt = Date.now();
    if (r.status >= 500) tripBreaker(providerHealth.lastError);
    else if (consecutiveFails >= 8) tripBreaker("upstox repeated failures");
    throw new Error(`upstox ${path} ${r.status}`);
  }
  consecutiveFails = 0;
  providerHealth.state = "ok";
  providerHealth.lastOkAt = Date.now();
  return r.json();
}

function tripBreaker(msg: string) {
  providerHealth.lastError = msg;
  providerHealth.lastErrorAt = Date.now();
  if (consecutiveFails >= 5 && Date.now() >= circuitOpenUntil) {
    circuitOpenUntil = Date.now() + 30000; // 30s cooldown
    providerHealth.state = "down";
  } else {
    providerHealth.state = "degraded";
  }
}

export function providerHealthInfo() {
  return {
    ...providerHealth,
    circuitOpenSec: Math.max(
      0,
      Math.ceil((circuitOpenUntil - Date.now()) / 1000),
    ),
    limits: { perSec: LIMIT_PER_SEC, perMin: LIMIT_PER_MIN },
  };
}

// Resolve any NSE symbol to an Upstox instrument key:
// static map -> instrument master (ISIN) -> last-resort ticker form.
export async function resolveUpstoxKey(symbol: string): Promise<string> {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return "";
  if (UPSTOX_MAP[sym]) return UPSTOX_MAP[sym];
  try {
    const { lookupInstrumentKey } = await import("./instruments");
    const key = await lookupInstrumentKey(sym);
    if (key) return key;
  } catch (e: any) {
    // Logged, not swallowed. This catch used to be silent, which turned a real
    // master-loading failure into "every unmapped symbol quietly falls back to
    // ticker form and returns no data" — indistinguishable from a bad symbol.
    console.error(
      `[instruments] master lookup failed for ${sym}: ${e?.message || e}`,
    );
  }
  return `NSE_EQ|${sym}`;
}

/**
 * The same call path as the internal helper, exported so sibling modules
 * (market info, news) share this token bucket and circuit breaker.
 *
 * They must. Every caller that opens its own budget instead works against a
 * provider that already answers 429 when pushed, and the breaker is per-process
 * — a second copy would happily hammer a failing endpoint the first copy has
 * already given up on.
 */
export const upstoxGet = (path: string) => get(path);

export async function upstoxLtp(keys: string[]) {
  const q = keys.map((k) => encodeURIComponent(k)).join(",");
  const j: any = await get(`/market-quote/ltp?instrument_key=${q}`);
  const data = j?.data ?? {};
  const out: { key: string; ltp: number }[] = [];
  for (const k of keys) {
    // Upstox keys ISIN queries back under ticker form
    // (query NSE_EQ|INE002A01018 -> data key NSE_EQ:RELIANCE),
    // so fall back to matching instrument_token.
    const d =
      data[k.replace("|", ":")] ??
      data[k] ??
      Object.values(data).find((v: any) => v?.instrument_token === k);
    const ltp = (d as any)?.last_price ?? (d as any)?.ltp ?? 0;
    if (ltp) out.push({ key: k, ltp });
  }
  return out;
}

export async function upstoxExpiries(underlyingKey: string) {
  const j: any = await get(
    `/option/contract?instrument_key=${encodeURIComponent(underlyingKey)}`,
  );
  const list: any[] = j?.data ?? [];
  const exps = [...new Set(list.map((c) => c?.expiry).filter(Boolean))].sort();
  return exps.slice(0, 12);
}

export async function upstoxChain(underlyingKey: string, expiry: string) {
  const j: any = await get(
    `/option/chain?instrument_key=${encodeURIComponent(underlyingKey)}&expiry_date=${expiry}`,
  );
  return j;
}

// Upstox candle intervals: 1minute|30minute|day|week|month.
// Historical path: /historical-candle/{key}/{interval}/{to_date}/{from_date}
export async function upstoxCandles(
  key: string,
  interval: string,
  toDate: string,
  fromDate?: string,
) {
  const tail = fromDate ? `/${fromDate}` : ``;
  const j: any = await get(
    `/historical-candle/${encodeURIComponent(key)}/${interval}/${toDate}${tail}`,
  );
  return j?.data?.candles ?? [];
}

// Full OHLC quote for one instrument (open/high/low/close/volume/ltp + depth).
export async function upstoxFullQuote(key: string) {
  const j: any = await get(
    `/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`,
  );
  const data = j?.data ?? {};
  const d =
    data[key.replace("|", ":")] ??
    data[key] ??
    Object.values(data).find((v: any) => v?.instrument_token === key) ??
    {};
  const ohlc = (d as any)?.ohlc ?? {};
  const depth = (d as any)?.depth ?? {};
  const net = Number((d as any)?.net_change ?? 0);
  const ltp = (d as any)?.last_price ?? 0;
  const level = (b: any) => ({
    price: Number(b?.price ?? 0),
    qty: Number(b?.quantity ?? 0),
    orders: Number(b?.orders ?? 0),
  });
  return {
    ltp,
    open: ohlc?.open ?? 0,
    high: ohlc?.high ?? 0,
    low: ohlc?.low ?? 0,
    close: ohlc?.close ?? 0,
    prevClose: net ? ltp - net : (ohlc?.close ?? 0),
    netChange: net,
    volume: (d as any)?.volume ?? 0,
    oi: (d as any)?.oi ?? (d as any)?.open_interest ?? null,
    oiDayHigh: (d as any)?.oi_day_high ?? null,
    oiDayLow: (d as any)?.oi_day_low ?? null,
    vwap: (d as any)?.average_price ?? 0,
    totalBuyQty: (d as any)?.total_buy_quantity ?? 0,
    totalSellQty: (d as any)?.total_sell_quantity ?? 0,
    upperCircuit: (d as any)?.upper_circuit_limit ?? 0,
    lowerCircuit: (d as any)?.lower_circuit_limit ?? 0,
    lastTradeTime: Number((d as any)?.last_trade_time ?? 0) || null,
    depth: {
      buy: Array.isArray(depth?.buy) ? depth.buy.map(level) : [],
      sell: Array.isArray(depth?.sell) ? depth.sell.map(level) : [],
    },
  };
}

// Batch OHLC quotes (ltp + prev close for % change). One HTTP call for ≤10 keys.
// NOTE: Upstox `ohlc.close` is the session close so far (equals LTP intraday),
// so the previous close is derived from net_change for accurate day %.
export async function upstoxBatchQuotes(keys: string[]) {
  const q = keys.map((k) => encodeURIComponent(k)).join(",");
  const j: any = await get(`/market-quote/quotes?instrument_key=${q}`);
  const data = j?.data ?? {};
  return keys.map((k) => {
    const d: any =
      data[k.replace("|", ":")] ??
      data[k] ??
      Object.values(data).find((v: any) => v?.instrument_token === k) ??
      {};
    const ohlc = d?.ohlc ?? {};
    const ltp = d?.last_price ?? 0;
    const net = Number(d?.net_change ?? 0);
    return {
      key: k,
      ltp,
      open: ohlc?.open ?? 0,
      high: ohlc?.high ?? 0,
      low: ohlc?.low ?? 0,
      close: net ? ltp - net : (ohlc?.close ?? 0),
      netChange: net,
      volume: d?.volume ?? 0,
      // Provider last-trade time. Lets callers rank this snapshot against a
      // live socket tick instead of assuming "received now == fresh".
      lastTradeTime: Number(d?.last_trade_time ?? 0) || 0,
    };
  });
}
