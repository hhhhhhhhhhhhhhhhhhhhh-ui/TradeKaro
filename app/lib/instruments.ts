import { promises as fs } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

// Upstox instrument master (NSE). Quotes reject ticker-form keys
// (NSE_EQ|RELIANCE) — equities need ISIN form, so resolve symbols
// against the official master once and cache the result on disk.

const URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz";
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_F = path.join(CACHE_DIR, "nse-instruments.json");
const MAX_AGE_MS = 7 * 864e5;

export type InstrumentMaster = {
  at: number;
  eq: Record<string, string>; // tradingsymbol -> instrument_key
  idx: Record<string, string>;
};

let master: InstrumentMaster | null = null;
let loading: Promise<InstrumentMaster> | null = null;

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
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = splitCsvLine(line);
    const key = c[0];
    const sym = c[2];
    const type = c[9];
    if (!key || !sym) continue;
    if (type === "EQUITY") eq[sym] = key;
    else if (type === "INDEX") idx[sym] = key;
  }
  const out: InstrumentMaster = { at: Date.now(), eq, idx };
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_F, JSON.stringify(out));
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
        if (j?.at && Date.now() - j.at < MAX_AGE_MS && j.eq) {
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
  return m.eq[sym] ?? m.idx[sym] ?? null;
}

export function instrumentMasterInfo() {
  return master
    ? {
        loaded: true,
        eq: Object.keys(master.eq).length,
        idx: Object.keys(master.idx).length,
        at: master.at,
      }
    : { loaded: false };
}
