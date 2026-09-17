import { NextResponse } from "next/server";

// POST /api/v1/getMarketCap — market-cap data isn't available from our
// Upstox feed yet; keep the endpoint shape with an empty list so the
// dashboard widgets degrade to their empty states.
export async function POST() {
  return NextResponse.json({ data: [] });
}
