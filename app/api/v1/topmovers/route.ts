import { NextRequest, NextResponse } from "next/server";
import {
  computeCommodityMovers,
  computeMovers,
  shapeMover,
} from "@/app/lib/movers";

// POST /api/v1/topmovers — movers for the public page, the screener and the
// dashboard card.
//
// This file used to carry its OWN copy of the universe and the whole batching
// loop, duplicating app/lib/movers.ts line for line — and the two had already
// drifted: this one listed BAJAJ_AUTO and the shared one did not, so the
// dashboard and the public endpoint were ranking different sets of stocks. It
// now calls the shared implementation, which owns the universe and the quoting.
//
// The response shape is unchanged from the retired worker (nested company/stats
// plus flat keys), so every existing caller keeps working.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const size = Math.max(1, Math.min(20, Number(body?.size) || 10));

  const [equities, commodities] = await Promise.all([
    computeMovers(size),
    computeCommodityMovers(size),
  ]);

  if (!equities.providerOn)
    return NextResponse.json(
      {
        TOP_GAINERS: { items: [] },
        TOP_LOSERS: { items: [] },
        TOP_VOLUME: { items: [] },
        TOP_COMMODITIES: { items: [] },
      },
      { status: 412 },
    );

  return NextResponse.json({
    TOP_GAINERS: { items: equities.gainers.map(shapeMover) },
    TOP_LOSERS: { items: equities.losers.map(shapeMover) },
    TOP_VOLUME: { items: equities.byVolume.map(shapeMover) },
    // Its own group rather than folded into the gainers. A 2% move in gold and a
    // 2% move in a large-cap are not the same event — different volatility,
    // different session — so the page tabs them separately instead of pretending
    // they belong in one ranking. Ranked by absolute change, so both directions
    // show up in the one list.
    TOP_COMMODITIES: { items: commodities.map(shapeMover) },
  });
}
