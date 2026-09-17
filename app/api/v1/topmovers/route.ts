import { NextRequest, NextResponse } from "next/server";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { cached } from "@/app/lib/marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "@/app/lib/upstox";

// POST /api/v1/topmovers — replaces the external worker's movers feed.
// Computed from live Upstox quotes over a liquid NIFTY-50 universe,
// shaped like the old worker payload (nested company/stats + flat keys).

const UNIVERSE: Record<string, string> = {
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
  BAJAJ_AUTO: "Bajaj Auto",
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

type Item = {
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

function shape(items: Item[]) {
  return items.map((i) => ({
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
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const size = Math.max(1, Math.min(20, Number(body?.size) || 10));

  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (!hasUpstox() || rs?.providerOff)
    return NextResponse.json(
      {
        TOP_GAINERS: { items: [] },
        TOP_LOSERS: { items: [] },
        TOP_VOLUME: { items: [] },
      },
      { status: 412 },
    );

  const symbols = Object.keys(UNIVERSE);
  const all: Item[] = [];
  try {
    for (let i = 0; i < symbols.length; i += 10) {
      const chunk = symbols.slice(i, i + 10);
      const { data } = await cached(
        `movers:${chunk.join(",")}`,
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
                name: UNIVERSE[sym] || sym,
                ltp,
                dayChange: prev ? ltp - prev : 0,
                dayChangePerc: prev ? ((ltp - prev) / prev) * 100 : 0,
                volume: Number(q.volume) || 0,
                open: Number(q.open) || 0,
                high: Number(q.high) || 0,
                low: Number(q.low) || 0,
                close: prev,
              } as Item;
            })
            .filter((t) => t.ltp > 0);
        },
      );
      all.push(...(data as Item[]));
    }
  } catch {
    /* partial results are fine */
  }

  const gainers = [...all]
    .filter((i) => i.dayChangePerc > 0)
    .sort((a, b) => b.dayChangePerc - a.dayChangePerc)
    .slice(0, size);
  const losers = [...all]
    .filter((i) => i.dayChangePerc < 0)
    .sort((a, b) => a.dayChangePerc - b.dayChangePerc)
    .slice(0, size);
  const volume = [...all].sort((a, b) => b.volume - a.volume).slice(0, size);

  return NextResponse.json({
    TOP_GAINERS: { items: shape(gainers) },
    TOP_LOSERS: { items: shape(losers) },
    TOP_VOLUME: { items: shape(volume) },
  });
}
