import { NextRequest, NextResponse } from "next/server";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { cached } from "@/app/lib/marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxFullQuote,
} from "@/app/lib/upstox";

// POST /api/v1/getOrderBook — legacy depth endpoint (used as a fallback
// by the order-book hook). Served from Upstox full quotes.
export async function POST(req: NextRequest) {
  const { symbol = "NIFTY" } = await req.json().catch(() => ({}));
  const sym = String(symbol).toUpperCase();
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (!hasUpstox() || rs?.providerOff)
    return NextResponse.json({ orderData: null }, { status: 412 });
  try {
    const { data: q } = await cached(
      `fq:${sym}`,
      rs?.ttl?.quote || 5000,
      async () => upstoxFullQuote(await resolveUpstoxKey(sym)),
    );
    const quote = q as Awaited<ReturnType<typeof upstoxFullQuote>>;
    return NextResponse.json({
      orderData: {
        buyBook: quote.depth?.buy ?? [],
        sellBook: quote.depth?.sell ?? [],
        tsInMillis: Date.now(),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { orderData: null, error: e?.message || "quote failed" },
      { status: 502 },
    );
  }
}
