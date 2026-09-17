import { NextResponse } from "next/server";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { cached } from "@/app/lib/marketCache";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "@/app/lib/upstox";

// POST /api/v1/getIndices — replaces the worker's NSE/BSE index feed.
// Reproduces its nested shape so the dashboard cards render unchanged.

const INDICES: { key: string; symbol: string }[] = [
  { key: "NIFTY", symbol: "NIFTY" },
  { key: "BANKNIFTY", symbol: "BANKNIFTY" },
  { key: "FINNIFTY", symbol: "FINNIFTY" },
  { key: "NIFTYMIDSELECT", symbol: "NIFTYMIDSELECT" },
];
const SENSEX_KEY = "1"; // legacy BSE map key

export async function POST() {
  const empty = {
    data: {
      data: {
        exchangeAggRespMap: {
          NSE: { indexLivePointsMap: {} },
          BSE: { indexLivePointsMap: {} },
        },
      },
    },
  };
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (!hasUpstox() || rs?.providerOff) return NextResponse.json(empty);

  const nse: Record<string, any> = {};
  let bse: any = null;
  try {
    const { data } = await cached("indices:core", 10000, async () => {
      const keys = await Promise.all(
        [...INDICES.map((i) => i.symbol), "SENSEX"].map((s) =>
          resolveUpstoxKey(s),
        ),
      );
      return upstoxBatchQuotes(keys);
    });
    const quotes = data as Awaited<ReturnType<typeof upstoxBatchQuotes>>;
    // Quotes arrive in request order: NIFTY, BANKNIFTY, FINNIFTY, MIDCP, SENSEX.
    const entry = (q: (typeof quotes)[number] | undefined) => {
      if (!q || !q.ltp) return null;
      const prev = Number(q.close) || q.ltp;
      return {
        value: q.ltp,
        dayChange: q.ltp - prev,
        dayChangePerc: prev ? ((q.ltp - prev) / prev) * 100 : 0,
      };
    };
    INDICES.forEach((idx, i) => {
      const e = entry(quotes[i]);
      if (e) nse[idx.key] = e;
    });
    const six = entry(quotes[INDICES.length]);
    if (six) bse = six;
  } catch {
    /* empty map on failure */
  }

  return NextResponse.json({
    data: {
      data: {
        exchangeAggRespMap: {
          NSE: { indexLivePointsMap: nse },
          BSE: { indexLivePointsMap: bse ? { [SENSEX_KEY]: bse } : {} },
        },
      },
    },
  });
}
