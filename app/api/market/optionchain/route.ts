import { NextRequest, NextResponse } from "next/server";
import {
  hasUpstox,
  upstoxChain,
  upstoxExpiries,
  resolveUpstoxKey,
} from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { setRuntimeToken } from "@/app/lib/upstox";

// Shared board: one Upstox chain per underlying+expiry per 5s for all users.
export async function POST(req: NextRequest) {
  const { underlying = "NIFTY", expiry = "" } = await req
    .json()
    .catch(() => ({}) as any);
  const u = String(underlying).toUpperCase();
  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { error: "Maintenance", mock: true },
      { status: 503 },
    );
  // Upstox-only live chain path.
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      {
        error: "Set UPSTOX_ANALYTICS_TOKEN in .env.local",
        mock: true,
      },
      { status: 412 },
    );
  try {
    const key = await resolveUpstoxKey(u);
    const { data: expiries } = await cached(
      `expiries:${u}`,
      rs.ttl.expiries || 43200000,
      () => upstoxExpiries(key),
    );
    let exp = expiry || expiries[0] || "";
    if (!exp)
      return NextResponse.json({ error: "No expiry found" }, { status: 404 });
    const { data: payload, cached: hit } = await cached(
      `chain:${u}:${exp}`,
      rs.ttl.chain || 5000,
      async () => {
        const j: any = await upstoxChain(key, exp);
        const rows = (j?.data ?? []).map((r: any) => ({
          strike: r?.strike_price,
          ceLtp: r?.call_options?.market_data?.ltp ?? 0,
          peLtp: r?.put_options?.market_data?.ltp ?? 0,
          ceOI: r?.call_options?.market_data?.oi ?? 0,
          peOI: r?.put_options?.market_data?.oi ?? 0,
          ceVol: r?.call_options?.market_data?.volume,
          peVol: r?.put_options?.market_data?.volume,
          ceIV: r?.call_options?.option_greeks?.iv,
          peIV: r?.put_options?.option_greeks?.iv,
        }));
        if (!rows.length) throw new Error("Empty chain");
        return { expiry: exp, rows };
      },
    );
    return NextResponse.json(
      {
        expiry: payload.expiry,
        rows: payload.rows,
        source: "upstox",
        cached: hit,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "chain failed" },
      { status: 502 },
    );
  }
}
