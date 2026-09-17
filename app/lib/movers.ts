import { runtimeSettings } from "./adminRuntime";
import { commoditySymbols } from "./instruments";
import { cached } from "./marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "./upstox";

// Live movers over a liquid NIFTY-50 universe — shared by the public
// /topmovers endpoint and the dashboard's /getTopMovers variant.

export const UNIVERSE: Record<string, string> = {
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  HDFCBANK: "HDFC Bank",
  ICICIBANK: "ICICI Bank",
  INFY: "Infosys",
  HINDUNILVR: "Hindustan Unilever",
  ITC: "ITC",
  SBIN: "State Bank of India",
  BHARTIARTL: "Bharti Airtel",
  KOTAKBANK: "Kotak Mahindra Bank",
  LT: "Larsen & Toubro",
  AXISBANK: "Axis Bank",
  ASIANPAINT: "Asian Paints",
  MARUTI: "Maruti Suzuki",
  TITAN: "Titan Company",
  SUNPHARMA: "Sun Pharmaceutical",
  BAJFINANCE: "Bajaj Finance",
  WIPRO: "Wipro",
  ULTRACEMCO: "UltraTech Cement",
  NESTLEIND: "Nestle India",
  ONGC: "ONGC",
  NTPC: "NTPC",
  POWERGRID: "Power Grid",
  "M&M": "Mahindra & Mahindra",
  TATAMOTORS: "Tata Motors",
  TATASTEEL: "Tata Steel",
  JSWSTEEL: "JSW Steel",
  ADANIENT: "Adani Enterprises",
  ADANIPORTS: "Adani Ports",
  COALINDIA: "Coal India",
  GRASIM: "Grasim Industries",
  HCLTECH: "HCL Technologies",
  TECHM: "Tech Mahindra",
  CIPLA: "Cipla",
  DRREDDY: "Dr Reddy's Labs",
  DIVISLAB: "Divi's Laboratories",
  EICHERMOT: "Eicher Motors",
  HEROMOTOCO: "Hero MotoCorp",
  BRITANNIA: "Britannia Industries",
  INDUSINDBK: "IndusInd Bank",
  SHREECEM: "Shree Cement",
  HDFCLIFE: "HDFC Life",
  SBILIFE: "SBI Life",
  APOLLOHOSP: "Apollo Hospitals",
  BAJAJFINSV: "Bajaj Finserv",
  TATACONSUM: "Tata Consumer",
  UPL: "UPL",
  BPCL: "BPCL",
  VBL: "Varun Beverages",
};

export type Mover = {
  symbol: string;
  name: string;
  ltp: number;
  dayChangePerc: number;
  dayChange: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function shapeMover(i: Mover) {
  return {
    ...i,
    company: {
      companyName: i.name,
      nseScriptCode: i.symbol,
      equityType: "STOCKS",
      marketCap: 0,
      logoUrl: null,
    },
    stats: {
      ltp: i.ltp,
      dayChange: i.dayChange,
      dayChangePerc: i.dayChangePerc,
      open: i.open,
      high: i.high,
      low: i.low,
      close: i.close,
      volume: i.volume,
      yearHighPrice: 0,
      yearLowPrice: 0,
    },
  };
}

/**
 * Quote a bag of symbols and shape them as movers.
 *
 * Batched ten at a time because the provider caps a batch request, and cached
 * per chunk so the movers page and the screener share one upstream call. A
 * failed chunk is skipped rather than thrown: half a page of movers beats none.
 */
async function quoteMovers(
  ns: string,
  symbols: string[],
  nameOf: (s: string) => string,
): Promise<Mover[]> {
  const all: Mover[] = [];
  for (let i = 0; i < symbols.length; i += 10) {
    const chunk = symbols.slice(i, i + 10);
    try {
      const { data } = await cached(
        `movers:${ns}:${chunk.join(",")}`,
        60000,
        async () => {
          const keys = await Promise.all(chunk.map((s) => resolveUpstoxKey(s)));
          const quotes = await upstoxBatchQuotes(keys);
          return quotes
            .map((q, idx) => {
              const sym = chunk[idx];
              const prev = Number(q.close) || 0;
              const ltp = Number(q.ltp) || 0;
              return {
                symbol: sym,
                name: nameOf(sym),
                ltp,
                dayChange: prev ? ltp - prev : 0,
                dayChangePerc: prev ? ((ltp - prev) / prev) * 100 : 0,
                volume: Number(q.volume) || 0,
                open: Number(q.open) || 0,
                high: Number(q.high) || 0,
                low: Number(q.low) || 0,
                close: prev,
              } as Mover;
            })
            .filter((t) => t.ltp > 0);
        },
      );
      all.push(...(data as Mover[]));
    } catch {
      /* partial results are fine */
    }
  }
  return all;
}

async function providerReady(): Promise<boolean> {
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  return Boolean(hasUpstox()) && !rs?.providerOff;
}

export async function computeMovers(size: number): Promise<{
  gainers: Mover[];
  losers: Mover[];
  byVolume: Mover[];
  providerOn: boolean;
}> {
  if (!(await providerReady()))
    return { gainers: [], losers: [], byVolume: [], providerOn: false };

  const all = await quoteMovers(
    "eq",
    Object.keys(UNIVERSE),
    (s) => UNIVERSE[s] || s,
  );
  const gainers = [...all]
    .filter((m) => m.dayChangePerc > 0)
    .sort((a, b) => b.dayChangePerc - a.dayChangePerc)
    .slice(0, size);
  const losers = [...all]
    .filter((m) => m.dayChangePerc < 0)
    .sort((a, b) => a.dayChangePerc - b.dayChangePerc)
    .slice(0, size);
  const byVolume = [...all].sort((a, b) => b.volume - a.volume).slice(0, size);
  return { gainers, losers, byVolume, providerOn: true };
}

/**
 * The commodity movers.
 *
 * Read from the instrument master rather than a hardcoded list. The equity
 * universe above is exactly the kind of static table that left commodities out
 * of every market-survey surface — a hand-kept list cannot learn about a new MCX
 * root, and this one does, for free.
 *
 * Ranked by ABSOLUTE day change, because one list has to carry both directions:
 * on a volatile day in gold the losers are as interesting as the gainers, and
 * splitting them into two more tabs would bury the page's whole point.
 */
export async function computeCommodityMovers(size: number): Promise<Mover[]> {
  if (!(await providerReady())) return [];
  const symbols = await commoditySymbols().catch(() => []);
  if (!symbols.length) return [];
  const all = await quoteMovers("cmdty", symbols, (s) => s);
  return all
    .sort((a, b) => Math.abs(b.dayChangePerc) - Math.abs(a.dayChangePerc))
    .slice(0, size);
}
