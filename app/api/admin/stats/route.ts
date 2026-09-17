import { NextRequest, NextResponse } from "next/server";
import { cacheInfo } from "@/app/lib/marketCache";
import { hasUpstox } from "@/app/lib/upstox";
import { adminFrom, deny } from "../_guard";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  return NextResponse.json({
    upstox: hasUpstox(),
    ...cacheInfo(),
    at: Date.now(),
  });
}
