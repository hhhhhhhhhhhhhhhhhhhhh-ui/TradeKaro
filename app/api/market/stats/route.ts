import { NextResponse } from "next/server";
import { cacheInfo } from "@/app/lib/marketCache";
import {
  hasUpstox,
  providerHealthInfo,
  setRuntimeToken,
} from "@/app/lib/upstox";
import { feedHealth } from "@/app/lib/feed";
import { instrumentMasterInfo } from "@/app/lib/instruments";
import { runtimeSettings } from "@/app/lib/adminRuntime";

// Health probe: cache hits vs Upstox calls proves sharing works.
export async function GET() {
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  return NextResponse.json({
    upstox: hasUpstox() && !rs?.providerOff,
    maintenance: rs?.maintenance || false,
    provider: providerHealthInfo(),
    feed: feedHealth(),
    instruments: instrumentMasterInfo(),
    ...cacheInfo(),
  });
}
