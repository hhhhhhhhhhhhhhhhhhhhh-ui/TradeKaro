import { NextRequest, NextResponse } from "next/server";
import {
  commissionsFor,
  payoutsFor,
  referralsFor,
  summary,
} from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET /api/partners/earnings — the full money view: every commission row, every
// payout request, and the balances those add up to.
//
// The numbers a partner actually cares about are named explicitly rather than
// left to be derived from the table:
//   available  — payable today
//   pending    — earned but still inside the holdback window
//   paid       — already sent
//
// `summary` still carries a `reversed` total, and commission rows can still
// carry that status, because the column exists in the schema. Nothing writes it:
// the panel used to show a "Reversed" filter and copy explaining reversals, and
// that was removed — a partner was being offered a state the product cannot
// reach. The field is left in the payload rather than stripped so a future
// reversal tool has somewhere to put its number.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const limited = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(500, Math.max(20, Number(limited) || 200));

  return NextResponse.json({
    summary: summary(g.affiliate.id),
    commissions: commissionsFor(g.affiliate.id, limit),
    payouts: payoutsFor(g.affiliate.id, limit),
    // Kept alongside the rows so the partner can see exactly how the money was
    // worked out instead of having to trust a number.
    terms: {
      model: g.affiliate.model,
      depositRate: g.affiliate.depositRate,
      revRate: g.affiliate.revRate,
      holdDays: g.affiliate.holdDays,
      minPayout: g.affiliate.minPayout,
      planName: g.affiliate.planName,
    },
    referrals: referralsFor(g.affiliate.id, limit),
  });
}
