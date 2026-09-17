import { NextRequest, NextResponse } from "next/server";
import {
  asAnnouncement,
  marketNews,
  newsForSymbols,
  newsLastError,
  newsSample,
} from "@/app/lib/news";

// POST /api/v1/announcements — news for the dashboard and stock-page cards.
//
// This used to return an empty list: the old build proxied an NSE filings worker
// that a self-hosted instance has no replacement for, so every news card sat in
// its empty state forever. It now answers from the provider's instrument news,
// which needs no separate source.
//
// The response shape is the one those cards already parse (`articles[]` with
// `subject`, `desc`, `url`, `source.name`), so neither component had to change.
//
// Pass `scrip` for one symbol, `symbols` for a portfolio, or neither for
// market-wide news. The keys are always derived from OUR side of the order —
// never from the provider's `positions` category, which would describe the
// linked brokerage account instead of this app's paper book.

/** Read `scrip`, or a `symbols` list, from a query or a JSON body. */
function wanted(get: (k: string) => string | undefined, body: any): string[] {
  const scrip = (get("scrip") || "").toUpperCase().trim();
  if (scrip) return [scrip];
  const raw = get("symbols") || body?.symbols;
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [
    ...new Set(
      list
        .map((s: any) => String(s || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

function payload(items: any[], wanted: string[], req: NextRequest) {
  return {
    status: "ok",
    source: items.length ? "upstox" : "none",
    // Empty feeds carry their reason: "no news" and "the fetch failed" are the
    // same response otherwise, and this project has already lost hours to it.
    ...(items.length ? {} : { reason: newsLastError() || "no items returned" }),
    // ?debug=1 returns a sample raw row, because the provider's field names are
    // undocumented and a wrong guess degrades quietly.
    ...(req.nextUrl.searchParams.get("debug")
      ? { sample: newsSample() }
      : {}),
    scrip: wanted.length === 1 ? wanted[0] : null,
    symbols: wanted,
    articles: items.map((it) => asAnnouncement(it, wanted[0])),
  };
}

async function respond(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means "market news" */
  }
  const symbols = wanted((k) => body?.[k], body);
  const items = symbols.length ? await newsForSymbols(symbols) : await marketNews();
  return NextResponse.json(payload(items, symbols, req));
}

export async function POST(req: NextRequest) {
  return respond(req);
}

/** Same payload over GET, so the feed is cacheable and easy to inspect. */
export async function GET(req: NextRequest) {
  const symbols = wanted((k) => req.nextUrl.searchParams.get(k) || undefined, null);
  const items = symbols.length ? await newsForSymbols(symbols) : await marketNews();
  return NextResponse.json(payload(items, symbols, req));
}
