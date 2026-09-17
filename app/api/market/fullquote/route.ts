import { NextRequest, NextResponse } from "next/server";
import {
  hasUpstox,
  setRuntimeToken,
  upstoxFullQuote,
  resolveUpstoxKey,
} from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { feedFresh, feedWarm } from "@/app/lib/feed";

// Live socket -> fullquote shape. Same field names the REST path returns, so
// every consumer keeps working; the difference is that these are real-time.
function fromFeed(t: {
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ts: number;
  oi?: number | null;
  atp?: number;
  tbq?: number;
  tsq?: number;
  depth?: {
    buy: { price: number; qty: number; orders: number }[];
    sell: { price: number; qty: number; orders: number }[];
  };
}) {
  return {
    ltp: t.ltp,
    open: t.open,
    high: t.high,
    low: t.low,
    // Upstox ohlc.close is the session close so far (ie the LTP intraday).
    close: t.ltp,
    prevClose: t.close,
    netChange: t.close ? t.ltp - t.close : 0,
    volume: t.volume,
    oi: t.oi ?? null,
    oiDayHigh: null,
    oiDayLow: null,
    vwap: t.atp ?? 0,
    totalBuyQty: t.tbq ?? 0,
    totalSellQty: t.tsq ?? 0,
    upperCircuit: 0,
    lowerCircuit: 0,
    lastTradeTime: t.ts,
    depth: t.depth ?? { buy: [], sell: [] },
  };
}

// Shared board: one Upstox full-quote per symbol per 5s for all users.
export async function POST(req: NextRequest) {
  const { symbol = "NIFTY" } = await req.json().catch(() => ({}) as any);
  const sym = String(symbol).toUpperCase();

  // The socket already holds a real-time version of this instrument.
  feedWarm();
  const live = feedFresh(sym);
  if (live)
    return NextResponse.json({
      symbol: sym,
      quote: fromFeed(live),
      source: "upstox",
      streamed: true,
      cached: true,
    });

  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { error: "Maintenance", quote: null, source: "none" },
      { status: 503 },
    );
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      { error: "Set UPSTOX_ANALYTICS_TOKEN", quote: null, source: "none" },
      { status: 412 },
    );
  try {
    const { data: quote, cached: hit } = await cached(
      `fullquote:${sym}`,
      rs.ttl.quote || 5000,
      async () => upstoxFullQuote(await resolveUpstoxKey(sym)),
    );
    return NextResponse.json({
      symbol: sym,
      quote,
      source: "upstox",
      cached: hit,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "quote failed", quote: null, source: "none" },
      { status: 502 },
    );
  }
}
