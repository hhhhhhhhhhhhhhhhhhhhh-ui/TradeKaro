import { NextRequest, NextResponse } from "next/server";
import { feedHealth, feedTouch } from "@/app/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/market/warm { symbols: string[], holdMs?: number }
//
// Pre-subscribe symbols on the shared Upstox socket. Used by hover over a
// search result and by pages as they mount, so the price is already streaming
// when the page asks for it — otherwise opening a fresh symbol waits ~1.4s for
// the client's SSE stream to be rebuilt.
//
// No upstream call happens unless the symbol is genuinely new, and the hold
// expires on its own (default 10 minutes), so this cannot leak subscriptions.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as any);
  const raw = Array.isArray(body?.symbols) ? body.symbols : [];
  const hold = Number(body?.holdMs);
  const holdMs = Number.isFinite(hold)
    ? Math.max(5_000, Math.min(1_800_000, hold))
    : 600_000;

  const touched = feedTouch(raw.map(String), holdMs);
  return NextResponse.json({
    ok: true,
    touched,
    holdMs,
    feed: feedHealth(),
  });
}
