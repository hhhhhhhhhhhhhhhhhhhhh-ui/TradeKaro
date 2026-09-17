import { NextRequest, NextResponse } from "next/server";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { cached } from "@/app/lib/marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxFullQuote,
} from "@/app/lib/upstox";

// POST /api/v1/getStockQuote — legacy endpoint kept for compatibility.
// The legacy contract sends btoa(symbol); accept both encoded + plain.
function decodeSymbol(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  try {
    const dec = Buffer.from(v, "base64").toString("utf8");
    if (dec && /^[A-Za-z0-9&.\- ]+$/.test(dec) && /^[A-Za-z0-9+/=]+$/.test(v))
      return dec.toUpperCase();
  } catch {
    /* not base64 — treat as plain */
  }
  return v.toUpperCase();
}

export async function POST(req: NextRequest) {
  const { symbol = "" } = await req.json().catch(() => ({}));
  const sym = decodeSymbol(symbol);
  if (!sym)
    return NextResponse.json({ error: "missing symbol" }, { status: 400 });
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (!hasUpstox() || rs?.providerOff)
    return NextResponse.json({ stockQuote: null }, { status: 412 });
  try {
    const { data: q } = await cached(
      `fq:${sym}`,
      rs?.ttl?.quote || 5000,
      async () => upstoxFullQuote(await resolveUpstoxKey(sym)),
    );
    const quote = q as Awaited<ReturnType<typeof upstoxFullQuote>>;
    const ltp = Number(quote.ltp) || 0;
    const prev = Number(quote.prevClose) || 0;
    return NextResponse.json({
      stockQuote: {
        symbol: sym,
        ltp,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: quote.volume,
        dayChange: prev ? ltp - prev : 0,
        dayChangePerc: prev ? ((ltp - prev) / prev) * 100 : 0,
        prevOpenInterest: null,
        openInterest: quote.oi ?? null,
        lowerCircuit: quote.lowerCircuit,
        upperCircuit: quote.upperCircuit,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { stockQuote: null, error: e?.message || "quote failed" },
      { status: 502 },
    );
  }
}
