import { NextRequest, NextResponse } from "next/server";
import {
  payoutAccounts,
  payoutsFor,
  requestPayout,
  summary,
} from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET  /api/partners/payouts — requests, balances and destinations
// POST /api/partners/payouts — REQUEST a payout
//
// A request moves no money. It records an intent that an operator then pays by
// hand and marks as paid. That is the whole design: UPI and USDT transfers are
// irreversible, so nothing here is allowed to send funds on its own.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  return NextResponse.json({
    summary: summary(g.affiliate.id),
    payouts: payoutsFor(g.affiliate.id),
    accounts: payoutAccounts(g.affiliate.id),
    minPayout: g.affiliate.minPayout,
    holdDays: g.affiliate.holdDays,
  });
}

export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  const body = await req.json().catch(() => ({}));

  const res = requestPayout({
    affiliateId: g.affiliate.id,
    amount: body?.amount,
    accountId: body?.accountId,
    note: body?.note,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    ok: true,
    id: res.id,
    message:
      "Payout requested. Our finance team reviews requests and sends the money to your chosen destination.",
    payouts: payoutsFor(g.affiliate.id),
    summary: summary(g.affiliate.id),
  });
}
