import { NextRequest, NextResponse } from "next/server";
import { hasUpstox, upstoxExpiries, upstoxKey } from "@/app/lib/upstox";
import { cached } from "@/app/lib/marketCache";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { setRuntimeToken } from "@/app/lib/upstox";

// Coldest data: expiries change weekly, share one fetch per 12h.
export async function POST(req: NextRequest) {
  const { underlying = "NIFTY" } = await req.json().catch(() => ({}) as any);
  const u = String(underlying).toUpperCase();
  const rs = await runtimeSettings();
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (rs.maintenance)
    return NextResponse.json(
      { error: "Maintenance", mock: true },
      { status: 503 },
    );
  if (!hasUpstox() || rs.providerOff)
    return NextResponse.json(
      { error: "Set UPSTOX_ANALYTICS_TOKEN", mock: true },
      { status: 412 },
    );
  try {
    const { data: expiries, cached: hit } = await cached(
      `expiries:${u}`,
      rs.ttl.expiries || 43200000,
      () => upstoxExpiries(upstoxKey(u)),
    );
    if (expiries.length)
      return NextResponse.json({ expiries, source: "upstox", cached: hit });
    return NextResponse.json({ error: "No expiries found" }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "expiry failed" },
      { status: 502 },
    );
  }
}
