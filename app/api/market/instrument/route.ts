import { NextRequest, NextResponse } from "next/server";
import {
  commodityContract,
  commoditySymbols,
  instrumentMasterInfo,
  lookupInstrumentKey,
} from "@/app/lib/instruments";
import { exchangeOfInstrument } from "@/app/lib/marketInfo";
import { EXCHANGE_LABEL, isCommoditySegment } from "@/app/lib/marketClock";

// Instrument metadata: what IS this symbol?
//
// The ticket has to know three things it cannot work out from the symbol alone,
// and none of them are guessable from the name:
//
//   * the lot size (MCX silver is 100 units, gold is 1 — a quantity that is not
//     a multiple of the lot is rejected by the exchange, and by the server gate)
//   * the tick size, so the limit stepper moves in valid increments
//   * the segment, because MCX trades to 23:30 while the cash market shuts at
//     15:30, and the ticket's order-button state has to match the server's
//
// Read-only and public: this is exchange reference data, not account data, and
// the master needs no provider token — it is a static file on a CDN. So this
// endpoint keeps answering while the quote feed is down, which is exactly when
// the UI most needs to know what a symbol is.

function describe(symbol: string, key: string | null, com: unknown) {
  const k = key || "";
  const segment = k ? exchangeOfInstrument(k) : "NSE";
  return {
    symbol,
    key: k || null,
    segment,
    segmentLabel: EXCHANGE_LABEL[segment],
    isCommodity: isCommoditySegment(segment),
    contract: com ?? null,
  };
}

export async function GET(req: NextRequest) {
  // `?all=commodities` lists every commodity root the master carries, which is
  // how the /commodities page builds its ladder without hardcoding 30 names.
  const all =
    req.nextUrl.searchParams.get("all") === "commodities"
      ? await commoditySymbols().catch(() => [])
      : [];

  const raw =
    req.nextUrl.searchParams.get("symbols") ||
    req.nextUrl.searchParams.get("symbol") ||
    "";
  const list = (
    all.length
      ? all
      : raw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
  ).slice(0, 200);

  if (!list.length)
    return NextResponse.json(
      { error: "Pass ?symbols=GOLD,SILVER, or ?all=commodities", items: [] },
      { status: 400 },
    );

  try {
    const items = await Promise.all(
      list.map(async (s) => {
        const [key, com] = await Promise.all([
          lookupInstrumentKey(s),
          commodityContract(s),
        ]);
        return describe(
          s,
          key,
          com
            ? {
                lot: com.lot,
                tick: com.tick,
                expiry: com.expiry,
                name: com.name,
              }
            : null,
        );
      }),
    );
    // A symbol the master does not carry is reported as unknown rather than
    // guessed at — the caller decides whether that is an error.
    return NextResponse.json(
      { items, unknown: items.filter((i) => !i.key).map((i) => i.symbol) },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "instrument lookup failed",
        items: [],
        master: instrumentMasterInfo(),
      },
      { status: 502 },
    );
  }
}
