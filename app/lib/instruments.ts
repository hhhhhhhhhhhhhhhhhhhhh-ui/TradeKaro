import { promises as fs } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

// Upstox instrument master. Quotes reject ticker-form keys (NSE_EQ|RELIANCE) —
// equities need ISIN form, so resolve symbols against the official master once
// and cache the result on disk.
//
// Reads `complete.csv.gz` rather than `NSE.csv.gz`: it carries every exchange in
// one file, which is what makes MCX commodities and the full index list
// available for about 1 MB more per day. BSE equities are deliberately skipped —
// they roughly double the searchable universe with names a beginner audience
// does not look for.
//
// The file is CRLF-terminated, so the LAST column arrives with a trailing \r.
// Trim the line before parsing, not one field: an `exchange === "NSE_EQ"` test
// skipped every equity while commodity prefixes still matched, which looks
// exactly like "the master is empty".

const URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz";
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_F = path.join(CACHE_DIR, "instruments.json");
/** Superseded by CACHE_F once the master stopped being NSE-only. */
const LEGACY_CACHE_F = path.join(CACHE_DIR, "nse-instruments.json");
const MAX_AGE_MS = 7 * 864e5;

/**
 * One tradable commodity future — the nearest expiry for that root symbol.
 *
 * Commodities trade in LOTS, not shares: MCX silver is 30 units minimum with a
 * ₹100 tick. The order gate has to know the lot size or it will accept a
 * quantity the exchange would reject.
 */
export type CommodityContract = {
  /** e.g. `MCX_FO|579304` */
  key: string;
  /** Root name as the customer knows it: SILVER, GOLD, CRUDEOIL. */
  name: string;
  /** Minimum traded quantity. */
  lot: number;
  tick: number;
  /** YYYY-MM-DD */
  expiry: string;
};

export type InstrumentMaster = {
  at: number;
  eq: Record<string, string>; // tradingsymbol -> instrument_key
  idx: Record<string, string>;
  com: Record<string, CommodityContract>; // root name -> nearest contract
};

let master: InstrumentMaster | null = null;
let loading: Promise<InstrumentMaster> | null = null;
/**
 * Why the last load failed, if it did.
 *
 * This exists because the failure was invisible: the build threw, the caller's
 * catch swallowed it, and `console.error` from a route handler did not surface
 * in the server log. An empty master and a broken master looked identical from
 * the outside. Surfaced through `instrumentMasterInfo()`.
 */
let lastError: string | null = null;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function build(): Promise<InstrumentMaster> {
  const r = await fetch(URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`instruments ${r.status}`);
  const text = gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const eq: Record<string, string> = {};
  const idx: Record<string, string> = {};
  // Built in two passes so the nearest expiry wins regardless of file order —
  // the master lists contract months in no particular order.
  const best: Record<string, { c: CommodityContract; t: number }> = {};
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    // The master is CRLF-terminated, so `split("\n")` leaves a trailing \r on
    // the LAST column. That silently broke an `exchange === "NSE_EQ"` test here
    // — every equity was skipped while commodities still matched, because they
    // only test a prefix. Trim the line, not one field, so any future
    // last-column comparison is safe too.
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const c = splitCsvLine(line);
    const key = c[0];
    const sym = c[2];
    const type = c[9];
    const exchange = (c[11] || "").trim();
    if (!key || !sym) continue;

    if (type === "EQUITY") {
      // NSE cash only; BSE equities are intentionally not indexed.
      if (exchange === "NSE_EQ") eq[sym] = key;
      continue;
    }
    if (type === "INDEX") {
      idx[sym] = key;
      continue;
    }
    if (type === "FUTCOM") {
      const name = (c[3] || "").toUpperCase().trim();
      const expiry = (c[5] || "").slice(0, 10);
      const lot = Number(c[8]);
      const tick = Number(c[7]);
      if (!name || !expiry) continue;
      // MCX is the exchange customers mean by "commodities", so it wins any
      // name clash with NSE's commodity segment.
      const rank = exchange.startsWith("MCX") ? 0 : 1;
      const t = Date.parse(expiry);
      const prev = best[name];
      if (
        !prev ||
        rank < (prev.c as any).__rank ||
        (rank === (prev.c as any).__rank && t < prev.t)
      ) {
        best[name] = {
          c: { key, name, lot, tick, expiry },
          t,
        };
        (best[name].c as any).__rank = rank;
      }
    }
  }

  const com: Record<string, CommodityContract> = {};
  for (const [name, v] of Object.entries(best)) {
    const { __rank, ...contract } = v.c as any;
    com[name] = contract as CommodityContract;
  }

  const out: InstrumentMaster = { at: Date.now(), eq, idx, com };
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_F, JSON.stringify(out));
    // The old NSE-only cache is dead weight now; remove it so nothing reads a
    // stale master by accident.
    await fs.unlink(LEGACY_CACHE_F).catch(() => {});
  } catch {
    /* disk cache is best-effort */
  }
  return out;
}

export async function instrumentMaster(): Promise<InstrumentMaster> {
  if (master) return master;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await fs.readFile(CACHE_F, "utf8");
        const j = JSON.parse(raw) as InstrumentMaster;
        // `j.com` is required, so a cache written before commodities existed is
        // treated as stale and rebuilt rather than silently serving no
        // commodity data.
        if (j?.at && Date.now() - j.at < MAX_AGE_MS && j.eq && j.com) {
          master = j;
          return j;
        }
      } catch {
        /* no cache yet */
      }
      const built = await build();
      master = built;
      return built;
    })().catch((e) => {
      loading = null;
      lastError = String(e?.stack || e?.message || e).slice(0, 500);
      throw e;
    });
  }
  return loading;
}

export async function lookupInstrumentKey(
  symbol: string,
): Promise<string | null> {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return null;
  const m = await instrumentMaster();
  return m.eq[sym] ?? m.idx[sym] ?? m.com[sym]?.key ?? null;
}

/**
 * Is this a commodity root (GOLD, SILVER, CRUDEOIL…)?
 *
 * Async because it may have to load the master first. The order gate needs a
 * trustworthy answer: guessing "not a commodity" would route a commodity order
 * through the equity session and lot rules.
 */
export async function isCommoditySymbol(symbol: string): Promise<boolean> {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return false;
  const m = await instrumentMaster();
  return Boolean(m.com[sym]);
}

/** Lot size for a commodity root, or null when it is not one. */
export async function commodityContract(
  symbol: string,
): Promise<CommodityContract | null> {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return null;
  const m = await instrumentMaster();
  return m.com[sym] ?? null;
}

/** Root names, for search and for the symbol list. */
export async function commoditySymbols(): Promise<string[]> {
  const m = await instrumentMaster();
  return Object.keys(m.com).sort();
}

export function instrumentMasterInfo() {
  return master
    ? {
        loaded: true,
        eq: Object.keys(master.eq).length,
        idx: Object.keys(master.idx).length,
        com: Object.keys(master.com || {}).length,
        at: master.at,
      }
    : { loaded: false, loading: Boolean(loading), error: lastError };
}
