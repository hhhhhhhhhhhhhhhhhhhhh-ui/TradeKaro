import { NextRequest, NextResponse } from "next/server";
import { clickStats, landingPages } from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET /api/partners/links
//
// Everything the Links page needs to answer "what is actually working?":
//
//   • both link forms — the short one to share and the long one to debug
//   • every landing page with CLICKS, UNIQUE CLICKS, SIGNUPS and DEPOSITS
//   • every campaign tag the partner has used, with the same columns
//   • the last dozen clicks, so a new partner sees activity immediately
//
// Clicks and unique clicks are reported side by side and never merged. The first
// is every page load; the second is the first load per device per day. A partner
// refreshing their own link moves one and not the other.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const origin = req.nextUrl.origin;
  const code = g.affiliate.code;
  // `PT-DEMO01` → `DEMO01`. The prefix keeps codes from being mistaken for a
  // broker client code; it does not belong in a URL someone has to type.
  const shortCode = code.replace(/^PT-/, "");

  let isLocalhost = false;
  try {
    const host = new URL(origin).hostname;
    isLocalhost =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    /* leave false */
  }

  const stats = clickStats(g.affiliate.id, 30);
  const pages = landingPages();

  const withStats = pages.map((p, i) => {
    const s = stats.pages.find((x) => x.key === p.slug);
    return {
      ...p,
      url: `${origin}/l/${p.slug}?ref=${encodeURIComponent(code)}`,
      shortUrl: `${origin}/r/${shortCode}/${p.slug}`,
      clicks: s?.clicks || 0,
      unique: s?.unique || 0,
      signups: s?.signups || 0,
      deposited: s?.deposited || 0,
      lastClick: s?.lastClick || null,
      // Kept so the sort below stays stable for a partner with no traffic yet.
      order: i,
    };
  });

  // Best first, but ranked by MEASURED people — ordering by raw clicks would
  // put whichever link the partner tests most at the top.
  const sorted = [...withStats].sort(
    (a, b) => b.unique - a.unique || b.clicks - a.clicks || a.order - b.order,
  );
  const bestUnique = sorted[0]?.unique || 0;

  return NextResponse.json({
    code,
    shortCode,
    origin,
    isLocalhost,
    landingPages: sorted.map(({ order: _order, ...p }) => ({
      ...p,
      // Only meaningful once there is something to compare.
      isBest: bestUnique > 0 && p.unique === bestUnique,
    })),
    direct: {
      url: `${origin}/l/start?ref=${encodeURIComponent(code)}`,
      shortUrl: `${origin}/r/${shortCode}`,
      clicks: stats.pages.find((p) => p.key === "start")?.clicks || 0,
    },
    sources: stats.sources,
    tags: stats.tags,
    recent: stats.recent,
    totals: {
      clicks: stats.clicks,
      unique: stats.unique,
      windowClicks: stats.windowClicks,
      windowUnique: stats.windowUnique,
    },
  });
}
