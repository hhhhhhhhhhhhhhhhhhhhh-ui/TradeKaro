import { promises as fs } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

// Upstox instrument master. Symbols are resolved against the official master and
// cached on disk, so a quote always asks for the provider's own key rather than
// something assembled from the ticker.
//
// ⚠️ The bare-ticker fallback in `resolveUpstoxKey` DOES work for plain NSE cash
// symbols — `NSE_EQ|LODHA` returns a real quote. (An earlier version of this
// comment claimed quotes reject ticker-form keys. They do not, and believing it
// cost a long hunt: an unmapped symbol does not fail loudly, it quietly returns
// a different instrument or nothing at all. `instrumentMasterInfo()` is surfaced
// in the admin console for exactly that reason.)
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
  /**
   * Shape/derivation version.
   *
   * Bump whenever the parsing rules change. The disk cache is trusted for a
   * week, so without this a deployed fix would sit unused behind a cache written
   * by the previous build — which is exactly how the `name`-column root bug
   * would have survived its own fix in production.
   */
  v: number;
  at: number;
  eq: Record<string, string>; // tradingsymbol -> instrument_key
  idx: Record<string, string>;
  com: Record<string, CommodityContract>; // root name -> nearest contract
};

/** Bump on any change to how the master is derived. See `InstrumentMaster.v`. */
const MASTER_VERSION = 4;

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

/**
 * Quoted units in one lot, for roots the master reports wrongly.
 *
 * MCX quotes the gold family per 10 g while the contract is a round weight, and
 * `lot_size` does not consistently mean either the weight or the quoted units:
 * GOLD reports 1 (a 1 kg contract), GOLDM reports 100 (a 100 g contract) and
 * GOLDGUINEA reports 8 (an 8 g contract) — three different units in one column.
 * So these are stated absolutely, per root, rather than derived from it.
 *
 * Each was checked against live quotes, which is the only way to tell. GOLDPETAL
 * is unambiguously one gram and traded at ₹15,355:
 *
 *   GOLD       ₹1,53,048 / 100 units = ₹15,304.80 per 10 g   ~ ₹15,305/g  ✓
 *   GOLDM      ₹1,54,220 /  10 units = ₹15,422.00 per 10 g   ~ ₹15,422/g  ✓
 *   GOLDGUINEA ₹1,22,524 /   1 unit  = ₹15,315.50 per 8 g    ~ ₹15,315/g  ✓
 *   GOLD10G    ₹1,52,246 /   1 unit  = ₹15,224.60 per 10 g   ~ ₹15,224/g  ✓
 *
 * All four agree with the petal's rupees-per-gram, which is what fixes the
 * units. Taken at face value instead, one lot of GOLD would show ₹1.53 lakh of
 * exposure when a real lot is ₹1.53 crore.
 *
 * Everything absent from this table already reports the right figure, because
 * `lot_size` there IS the quoted units: SILVER 30 (30 kg, per kg), CRUDEOIL 100
 * (100 barrels, per barrel), COPPER 2500, ZINC 5, NATURALGAS 250.
 */
const QUOTED_UNITS_PER_LOT: Record<string, number> = {
  GOLD: 100, // 1 kg contract, quoted per 10 g
  GOLDM: 10, // 100 g contract, quoted per 10 g
  GOLDGUINEA: 1, // 8 g contract, quoted per 8 g
  GOLD10G: 1, // 10 g contract, quoted per 10 g
  GOLD1G: 1, // 1 g contract, quoted per gram
  GOLDPETAL: 1, // 1 g contract, quoted per gram
};

/**
 * The commodity root of a futures trading symbol.
 *
 * `SILVER10026SEPFUT` -> `SILVER100`, `GOLD27FEBFUT` -> `GOLD`. Everything before
 * the `DDMMM` expiry and the `FUT` suffix.
 *
 * This exists because the master's `name` column is not a root — it merges
 * genuinely different contracts. Both `GOLD27FEBFUT` and `GOLDPETAL26SEPFUT`
 * carry `name = "GOLD"`, so keying on it quoted gold petal (1 gram) to anyone
 * asking for gold, at roughly a hundredth of the price. Returns "" for anything
 * that does not parse, which drops the row rather than inventing a root.
 */
export function commodityRoot(tradingsymbol: string): string {
  const m = /^([A-Z][A-Z0-9]*?)(\d{2}[A-Z]{3})FUT$/.exec(
    String(tradingsymbol || "").toUpperCase(),
  );
  return m ? m[1] : "";
}

/**
 * Quoted units in one lot — what the ledger counts, and what the exchange prices.
 *
 * `lot` means "units per lot" everywhere downstream, so no caller needs to know
 * which roots are quoted in an unusual unit.
 */
export function quotedUnitsFor(root: string, lotSize: number): number {
  const override = QUOTED_UNITS_PER_LOT[root];
  const n = Number(override ?? lotSize);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
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
      // The root is in the TRADING SYMBOL, not the `name` column.
      //
      // `name` groups variants that are entirely different contracts: the master
      // labels GOLDPETAL (1 gram), GOLDM and GOLD (1 kg) all as "GOLD", and
      // SILVER, SILVERM and SILVER100 all as "SILVER". Keying on it meant a
      // customer asking for GOLD was silently quoted GOLD PETAL — a 1-gram
      // contract at a hundredth of the price — and SILVER resolved to SILVER100.
      // The trading symbol carries the real root: `GOLD27FEBFUT`, `GOLDPETAL26SEPFUT`.
      const name = commodityRoot(sym);
      const expiry = (c[5] || "").slice(0, 10);
      const lot = quotedUnitsFor(name, Number(c[8]));
      const tick = Number(c[7]);
      if (!name || !expiry) continue;
      const t = Date.parse(expiry);
      // Skip contracts that have already expired: the master still lists the
      // front month for a while after it stops trading, and "nearest expiry"
      // would otherwise pick a dead contract.
      if (!Number.isFinite(t) || t < Date.now() - 864e5) continue;
      // MCX is the exchange customers mean by "commodities", so it wins over
      // NSE's commodity segment for the same root.
      const rank = exchange.startsWith("MCX") ? 0 : 1;
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

  const out: InstrumentMaster = {
    v: MASTER_VERSION,
    at: Date.now(),
    eq,
    idx,
    com,
  };
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
        // `v` gates the derivation rules and `j.com` the commodity support: a
        // cache written before either existed is rebuilt rather than served.
        if (
          j?.at &&
          j.v === MASTER_VERSION &&
          Date.now() - j.at < MAX_AGE_MS &&
          j.eq &&
          j.com
        ) {
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
  // Commodities are checked FIRST, and deliberately.
  //
  // Exactly one root collides with an NSE ticker: SILVER, which is both the MCX
  // contract and a silver ETF on NSE. Equity-first meant asking for SILVER
  // returned the ETF, so the ticket showed a commodity's lot size against an
  // ETF's price. For a commodities-aware app the contract is the stronger
  // signal, and the ETF remains reachable through the master under its own key.
  return m.com[sym]?.key ?? m.eq[sym] ?? m.idx[sym] ?? null;
}

/**
 * Lot size for a commodity root, or null when it is not one.
 *
 * (An `isCommoditySymbol()` companion used to sit here — exported, and never
 * called from anywhere. The question the app actually asks is never "is this a
 * commodity" but "what lot, and which exchange", which this and
 * `segmentOfSymbol` answer between them.)
 */
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
