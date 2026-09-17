import { NextRequest, NextResponse } from "next/server";
import { computeMovers, shapeMover } from "@/app/lib/movers";

// POST /api/v1/getTopMovers — dashboard variant. The dashboard reads
// LARGECAP/MIDCAP/SMALLCAP buckets with a flat `items` fallback, so we
// serve both shapes (our universe is large-cap heavy).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const size = Math.max(1, Math.min(20, Number(body?.size) || 10));
  const { gainers, losers, byVolume } = await computeMovers(size);
  const bucket = (items: ReturnType<typeof shapeMover>[]) => ({
    LARGECAP: { items },
    MIDCAP: { items: [] },
    SMALLCAP: { items: [] },
    items,
  });
  return NextResponse.json({
    TOP_GAINERS: bucket(gainers.map(shapeMover)),
    TOP_LOSERS: bucket(losers.map(shapeMover)),
    TOP_VOLUME: bucket(byVolume.map(shapeMover)),
  });
}
