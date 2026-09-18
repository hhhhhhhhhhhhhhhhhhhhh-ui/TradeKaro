import { NextRequest, NextResponse } from "next/server";
import { cacheInfo } from "@/app/lib/marketCache";
import { hasUpstox } from "@/app/lib/upstox";
import { platformMoney } from "@/app/lib/adminMoney";
import { adminFrom, deny } from "../_guard";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  // `money` is the platform-wide book: what came in, what went out, what is held
  // for customers and how the trading has gone. Computed server-side because
  // every figure has to come from the same ledgers the writes use — and because
  // the one-pass P&L walk is not something a browser should be trusted with.
  //
  // It is O(fills) per call, which is fine for a console page a human refreshes,
  // and is deliberately NOT on any customer path.
  return NextResponse.json({
    upstox: hasUpstox(),
    ...cacheInfo(),
    money: platformMoney(),
    at: Date.now(),
  });
}
