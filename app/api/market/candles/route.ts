import { NextRequest, NextResponse } from "next/server";
import {
  hasUpstox,
  setRuntimeToken,
  upstoxCandles,
  resolveUpstoxKey,
} from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";

// Timeframe map: UI -> Upstox interval + fetch window + aggregation.
const TF: Record<string, { up: string; days: number; bucketMin: number }> = {
  "1m": { up: "1minute", days: 5, bucketMin: 1 },
  "5m": { up: "1minute", days: 10, bucketMin: 5 },
  "15m": { up: "1minute", days: 20, bucketMin: 15 },
  day: { up: "day", days: 365, bucketMin: 0 },
  week: { up: "week", days: 1095, bucketMin: 0 },
};

function bucketize(rows: any[], mins: number) {
  if (!mins || mins <= 1) return rows;
  const sec = mins * 60;
  const map = new Map<number, any[]>();
  for (const c of rows) {
    const t = Math.floor(Date.parse(c[0]) / 1000);
    const b = Math.floor(t / sec) * sec;
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(c);
  }
  const out: any[][] = [];
  for (const [b, grp] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const opens = grp.map((g: any[]) => Number(g[1]));
    const highs = grp.map((g: any[]) => Number(g[2]));
    const lows = grp.map((g: any[]) => Number(g[3]));
    const closes = grp.map((g: any[]) => Number(g[4]));
    const vols = grp.map((g: any[]) => Number(g[5] ?? 0));
    out.push([
      new Date(b * 1000).toISOString(),
      opens[0],
      Math.max(...highs),
      Math.min(...lows),
      closes[closes.length - 1],
      vols.reduce((a: number, v: number) => a + v, 0),
      0,
    ]);
  }
  return out;
}

// Cold data: one Upstox candle fetch per symbol+interval per 60s for all users.
export async function POST(req: NextRequest) {
  const { symbol = "NIFTY", interval = "day" } = await req
    .json()
    .catch(() => ({}) as any);
  const sym = String(symbol).toUpperCase();
  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { error: "Maintenance", candles: [], source: "none" },
      { status: 503 },
    );
  const win = rs.candleWindows?.[String(interval)] as
    | { days: number; bucketMin: number }
    | undefined;
  const tf = win
    ? {
        up: (TF[String(interval)] ?? TF.day).up,
        days: win.days,
        bucketMin: win.bucketMin,
      }
    : (TF[String(interval)] ?? TF.day);
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      { error: "Set UPSTOX_ANALYTICS_TOKEN", candles: [], source: "none" },
      { status: 412 },
    );
  try {
    const { data: candles, cached: hit } = await cached(
      `candles:${sym}:${interval}`,
      rs.ttl.candles || 60000,
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - tf.days * 864e5)
          .toISOString()
          .slice(0, 10);
        const raw: any[] = await upstoxCandles(
          await resolveUpstoxKey(sym),
          tf.up,
          today,
          from,
        );
        const rows = bucketize(raw || [], tf.bucketMin);
        // Upstox rows: [ts, open, high, low, close, volume, oi].
        // Return full OHLC so lightweight-charts can draw real candles.
        return rows.map((c: any[]) => ({
          time: Math.floor(Date.parse(c[0]) / 1000),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5] ?? 0),
        }));
      },
    );
    return NextResponse.json({ candles, source: "upstox", cached: hit });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "candles failed", candles: [], source: "none" },
      { status: 502 },
    );
  }
}
