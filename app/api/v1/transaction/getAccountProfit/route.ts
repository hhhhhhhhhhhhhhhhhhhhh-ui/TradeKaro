import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/app/lib/authStore";
import { accountProfit } from "@/app/lib/accountData";

// POST /api/v1/transaction/getAccountProfit — overall + per-scrip P&L
// computed from the derived ledger and live Upstox quotes.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out = await accountProfit(user.id, user.email);
  return NextResponse.json(out);
}
