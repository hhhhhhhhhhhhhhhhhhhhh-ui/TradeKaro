import { NextResponse } from "next/server";

// POST /api/v1/announcements — the old worker proxied an NSE filings feed.
// Self-hosted builds have no local filings source yet; return an empty
// list so the news cards show their empty state instead of erroring.
export async function POST() {
  return NextResponse.json({ status: "ok", articles: [] });
}
