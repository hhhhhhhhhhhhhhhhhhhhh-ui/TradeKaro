import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/app/lib/authStore";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { cached } from "@/app/lib/marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "@/app/lib/upstox";

// POST /api/v1/getWatchList — the user's saved symbols with live quotes,
// returned as a map keyed by scrip (shape the watchlist page expects).
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({}, { status: 401 });

  const symbols = user.watchlist.map((s) => s.toUpperCase());
  const out: Record<string, any> = {};
  if (!symbols.length) return NextResponse.json(out);

  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  const live = hasUpstox() && !rs?.providerOff;

  for (let i = 0; i < symbols.length; i += 10) {
    const chunk = symbols.slice(i, i + 10);
    let ticks: any[] = [];
    if (live) {
      try {
        const r = await cached(
          `wl:${chunk.join(",")}`,
          rs?.ttl?.quote || 5000,
          async () => {
            const keys = await Promise.all(
              chunk.map((s) => resolveUpstoxKey(s)),
            );
            const quotes = await upstoxBatchQuotes(keys);
            return quotes.map((q, idx) => ({ symbol: chunk[idx], ...q }));
          },
        );
        ticks = r.data as any[];
      } catch {
        /* fall through with empty quotes */
      }
    }
    for (const sym of chunk) {
      const t = ticks.find((x) => x.symbol === sym) || {};
      const ltp = Number(t.ltp) || 0;
      const prev = Number(t.close) || 0;
      out[sym] = {
        symbol: sym,
        ltp,
        dayChange: prev ? ltp - prev : 0,
        dayChangePerc: prev ? ((ltp - prev) / prev) * 100 : 0,
        open: Number(t.open) || 0,
        high: Number(t.high) || 0,
        low: Number(t.low) || 0,
        close: prev,
        volume: Number(t.volume) || 0,
      };
    }
  }
  return NextResponse.json(out);
}
