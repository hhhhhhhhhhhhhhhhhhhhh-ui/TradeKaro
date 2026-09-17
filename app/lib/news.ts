import { cached } from "./marketCache";
import { resolveUpstoxKey, upstoxGet } from "./upstox";

/**
 * Provider news, keyed by instrument.
 *
 * The provider exposes news only *by instrument* — there is no general market
 * feed — so "market news" here means news about the headline indices, and a
 * customer's feed means news about what they actually hold.
 *
 * It also offers a `positions` category, which reads the linked brokerage
 * account. That is deliberately NOT used: this app has its own paper ledger, and
 * asking the provider about "positions" would answer a different question about
 * a different account. Keys are always derived from OUR own book.
 */

/** The provider rejects more than 30 keys in one call. */
const MAX_KEYS = 30;
/** Only the last week is meaningful; older items are noise on a trade screen. */
const WINDOW_DAYS = 7;
const TTL_MS = 10 * 60_000;

/**
 * The "market news" basket.
 *
 * Deliberately large-cap STOCKS rather than index keys. The provider publishes
 * nothing against `NSE_INDEX|…` keys — verified: NIFTY, BANKNIFTY and SENSEX
 * return zero rows while the same call for RELIANCE, TCS or INFY returns dozens
 * — so an index-based feed renders permanently empty, which reads as "no news
 * today" rather than "wrong keys".
 *
 * These are the most liquid, most-written-about names, so they approximate the
 * market. Kept well under the 30-key limit so a caller can add their portfolio.
 */
export const MARKET_NEWS_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "LT",
  "AXISBANK",
  "KOTAKBANK",
  "MARUTI",
  "TATAMOTORS",
  "BAJFINANCE",
  "HINDUNILVR",
];

/**
 * Why the last news fetch produced nothing, if it failed.
 *
 * An empty feed and a broken feed look identical from the outside, and this
 * project has already lost hours to exactly that ambiguity once. Surfaced
 * through the API when the feed comes back empty.
 */
let lastError: string | null = null;

/**
 * A copy of the first raw provider row from the last fetch.
 *
 * Kept because the field names are not documented anywhere reliable and the
 * published timestamp in particular is easy to misname: a wrong guess yields
 * `publishedAt: null` on every item, which sorts the whole feed to the bottom of
 * itself and looks like "no dates" rather than "wrong key".
 */
let lastSample: string | null = null;

export function newsLastError() {
  return lastError;
}

export function newsSample() {
  return lastSample;
}

export type NewsItem = {
  id: string;
  heading: string;
  summary: string;
  thumbnail: string;
  url: string;
  /** Epoch ms, or null when the provider's timestamp will not parse. */
  publishedAt: number | null;
  instrumentKeys: string[];
  /** The trading symbol this belongs to, when one of the requested ones. */
  symbol?: string;
};

/**
 * Parse the provider's `published_time`.
 *
 * It is a plain NUMBER, not a date string — and `Date.parse` on a bare number
 * returns NaN rather than a date, so every item silently ended up with
 * `publishedAt: null`. That is a quiet failure with two visible symptoms: the
 * feed cannot be newest-first, and the age window silently stops filtering.
 *
 * Both units are accepted: epoch seconds is 10 digits, epoch milliseconds is 13,
 * so the 1e11 boundary separates them unambiguously until the year 5138.
 */
function parseTime(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Normalise one provider row.
 *
 * Defensive on purpose: a news item that fails to parse should drop out, not
 * throw and take the whole feed with it. News is decoration on a trading screen.
 */
function toItem(raw: any, i: number): NewsItem | null {
  const heading = String(raw?.heading || raw?.title || "").trim();
  const url = String(raw?.article_link || raw?.url || "").trim();
  if (!heading && !url) return null;
  const keys = Array.isArray(raw?.instrument_keys)
    ? raw.instrument_keys.map(String)
    : [];
  return {
    id: String(raw?.id || `${heading.slice(0, 40)}:${raw?.published_time || i}`),
    heading: heading || "Market update",
    summary: String(raw?.summary || "").trim(),
    thumbnail: String(raw?.thumbnail || "").trim(),
    url,
    publishedAt: parseTime(raw?.published_time ?? raw?.publishedAt),
    instrumentKeys: keys,
  };
}

/**
 * Flatten the provider's payload.
 *
 * `data` is an OBJECT keyed by instrument, not a list:
 *
 *   { status: "success",
 *     data: { "NSE_EQ|INE009A01021": [ { heading, summary, ... } ] } }
 *
 * Reading it as an array yields `[]`, which looks exactly like "no news today".
 * Each item is tagged with the key it arrived under so the card can name its
 * source. An array is still accepted, in case the shape ever changes back.
 */
function rowsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const out: any[] = [];
  for (const [key, list] of Object.entries(payload)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const keys = Array.isArray(raw?.instrument_keys)
        ? raw.instrument_keys
        : [key];
      out.push({ ...raw, instrument_keys: keys });
    }
  }
  return out;
}

async function fetchNews(keys: string[]): Promise<NewsItem[]> {
  const q = new URLSearchParams({
    category: "instrument_keys",
    instrument_keys: keys.slice(0, MAX_KEYS).join(","),
  });
  try {
    const j: any = await upstoxGet(`/news?${q.toString()}`);
    lastError = null;
    const rows = rowsOf(j?.data);
    lastSample = rows.length
      ? `keys=${Object.keys(rows[0] || {}).join(",")} · ${JSON.stringify(
          rows[0],
        ).slice(0, 700)}`
      : null;
    // "The call succeeded and had nothing in it" is indistinguishable from "the
    // call succeeded and we looked in the wrong place", and the second is a bug
    // rather than an empty feed. The raw shape is kept so the difference shows.
    if (!rows.length)
      lastError = `no rows · ${q.toString()} · raw=${JSON.stringify(j).slice(0, 400)}`;
    const cutoff = Date.now() - WINDOW_DAYS * 864e5;
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const [i, r] of rows.entries()) {
      const it = toItem(r, i);
      if (!it) continue;
      // Only filter on a date we actually parsed — an item with no timestamp is
      // kept rather than dropped, because dropping is what hides news.
      if (it.publishedAt !== null && it.publishedAt < cutoff) continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    out.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return out;
  } catch (e: any) {
    lastError = String(e?.message || e).slice(0, 300);
    return [];
  }
}

/**
 * News for a set of symbols.
 *
 * Returns [] rather than throwing. Every caller is a page or a card: a provider
 * outage should leave a "no fresh news" state, never a broken dashboard.
 */
export async function newsForSymbols(symbols: string[]): Promise<NewsItem[]> {
  try {
    const uniq = [...new Set(symbols.map((s) => String(s || "").toUpperCase()))]
      .filter(Boolean)
      .slice(0, MAX_KEYS);
    if (!uniq.length) return [];

    const resolved = await Promise.all(
      uniq.map(async (s) => {
        try {
          return { s, key: await resolveUpstoxKey(s) };
        } catch {
          return { s, key: "" };
        }
      }),
    );
    const keys = [...new Set(resolved.map((r) => r.key).filter(Boolean))];
    if (!keys.length) return [];
    // The provider answers keyed by instrument key, which is an ISIN for an
    // equity — useless as a label. This maps it back to the symbol the caller
    // asked about, so a card can say RELIANCE instead of INE002A01018.
    const byKey = new Map(
      resolved.filter((r) => r.key).map((r) => [r.key, r.s]),
    );

    const key = `news:${keys.slice().sort().join(",")}`;
    // An empty result deliberately throws instead of returning []: `cached`
    // stores whatever the fetcher yields, so caching a blank feed would blank
    // the news for the whole TTL even after the provider recovered. A throw is
    // never cached.
    const { data } = await cached(key, TTL_MS, async () => {
      const items = await fetchNews(keys);
      if (!items.length) throw new Error(lastError || "no news");
      return items;
    });
    return (data as NewsItem[]).map((it) => ({
      ...it,
      symbol: it.instrumentKeys.map((k) => byKey.get(k)).find(Boolean),
    }));
  } catch (e: any) {
    lastError = String(e?.message || e).slice(0, 300);
    return [];
  }
}

/** News about the headline indices, for the dashboard card and the /news page. */
export async function marketNews(): Promise<NewsItem[]> {
  return newsForSymbols(MARKET_NEWS_SYMBOLS);
}

/**
 * The shape the existing dashboard and stock-page cards already render.
 *
 * They read `subject || desc || title`, `url`, `source.name` and `symbol`, and
 * were written against the old NSE filings worker. Mapping here means those two
 * components keep working untouched.
 */
export function asAnnouncement(it: NewsItem, symbol?: string) {
  return {
    subject: it.heading,
    desc: it.summary,
    url: it.url,
    source: { name: symbol || it.symbol || "Market news" },
    symbol: symbol || it.symbol || "",
    date: it.publishedAt ? new Date(it.publishedAt).toISOString() : "",
    ts: it.publishedAt,
    thumbnail: it.thumbnail,
  };
}
