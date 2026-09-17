import { NextRequest, NextResponse } from "next/server";
import {
  hasUpstox,
  setRuntimeToken,
  upstoxBatchQuotes,
  resolveUpstoxKey,
} from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { feedFresh, feedWarm, type FeedTick } from "@/app/lib/feed";

// Client tick shape. `ts` is the PROVIDER's last-trade time on both paths, so
// the browser can tell a live socket tick from a delayed REST snapshot.
function streamedTick(t: FeedTick) {
  return {
    symbol: t.symbol,
    ltp: t.ltp,
    open: t.open,
    high: t.high,
    low: t.low,
    close: t.close,
    volume: t.volume,
    ts: t.ts,
    receivedAt: t.receivedAt,
    streamed: true,
    source: "upstox",
    atp: t.atp,
    tbq: t.tbq,
    tsq: t.tsq,
    oi: t.oi,
    depth: t.depth,
  };
}

// Shared board: the live socket is the price authority; the Upstox REST batch
// is only used for symbols the socket does not cover. That matters because the
// REST snapshot runs ~15 minutes behind the socket — serving it for a symbol
// the socket already knows would hand the client a stale price.
export async function POST(req: NextRequest) {
  // Aborted requests (very common while a page is still painting) throw here.
  const { symbols = [] } = await req.json().catch(() => ({}) as any);
  const list: string[] = (symbols as string[])
    .map((s) => String(s).toUpperCase())
    .slice(0, 10);
  if (list.length === 0)
    return NextResponse.json({ ticks: [], source: "none" });

  // Bring the socket up even when no browser stream is attached yet.
  feedWarm();

  // ── 1. Live socket: real-time, and costs no upstream call at all. ──
  const ticks: any[] = [];
  const needUpstream: string[] = [];
  for (const s of list) {
    const t = feedFresh(s);
    if (t) ticks.push(streamedTick(t));
    else needUpstream.push(s);
  }
  if (!needUpstream.length)
    return NextResponse.json({
      ticks,
      missing: [],
      source: "upstox",
      streamed: true,
      cached: true,
    });

  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { ticks, source: ticks.length ? "upstox" : "none", error: "Maintenance" },
      { status: ticks.length ? 200 : 503 },
    );
  // 412 = configuration problem (no token / provider halted by admin).
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      {
        ticks,
        source: ticks.length ? "upstox" : "none",
        error: rs.providerOff
          ? "Provider halted by admin"
          : "Set UPSTOX_ANALYTICS_TOKEN in .env.local",
      },
      { status: ticks.length ? 200 : 412 },
    );

  // ── 2. REST fallback for the rest of the universe. ──
  try {
    // Resolve every symbol against the instrument master (ISIN form),
    // so the whole 2000+ NSE universe works — not just the static map.
    const keys = await Promise.all(
      needUpstream.map((s) => resolveUpstoxKey(s)),
    );
    const { data: rest, cached: hit } = await cached(
      `quote:${[...needUpstream].sort().join(",")}`,
      rs.ttl.quote || 5000,
      async () => {
        const rev: Record<string, string> = {};
        needUpstream.forEach((s, i) => (rev[keys[i]] = s));
        const quotes = await upstoxBatchQuotes(keys);
        return quotes
          .filter((q) => q.ltp)
          .map((q, i) => ({
            symbol: rev[q.key] || needUpstream[i] || q.key,
            ltp: q.ltp,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
            // Provider last-trade time, never our own clock: stamping "now"
            // here would make a delayed snapshot look fresher than a live one.
            ts: q.lastTradeTime || 0,
            receivedAt: 0,
            streamed: false,
            source: "upstox",
          }));
      },
    );
    const merged = [...ticks, ...(rest as any[])];
    const found = new Set(merged.map((t) => t.symbol));
    const missing = list.filter((s) => !found.has(s));
    // 404 = upstream answered but symbol(s) returned no data.
    if (!merged.length && missing.length)
      return NextResponse.json(
        { ticks: [], missing, source: "none", error: "No data for symbol" },
        { status: 404 },
      );
    return NextResponse.json({
      ticks: merged,
      missing,
      source: "upstox",
      cached: hit,
    });
  } catch (e: any) {
    // Partial success is still success — hand back what the socket had.
    if (ticks.length)
      return NextResponse.json({
        ticks,
        missing: [],
        source: "upstox",
        streamed: true,
        cached: true,
      });
    return NextResponse.json(
      {
        ticks: [],
        source: "none",
        error: e?.message || "upstox quote failed",
      },
      { status: 502 },
    );
  }
}
