import { NextRequest, NextResponse } from "next/server";
import { referralsFor, series, summary } from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET /api/partners/referrals — the customers a partner sent, and what each one
// is worth. Deliberately no name, email or phone: a partner is entitled to know
// what their traffic earned, not to a copy of the customer database. The broker
// client code is enough to reconcile with a report, and is what the customer
// themselves would quote in a support ticket.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const referrals = referralsFor(g.affiliate.id, 300);
  const byCampaign = new Map<
    string,
    { campaign: string; signups: number; deposited: number }
  >();
  for (const r of referrals) {
    const key = r.campaign || "(none)";
    const row = byCampaign.get(key) || {
      campaign: key,
      signups: 0,
      deposited: 0,
    };
    row.signups += 1;
    row.deposited += r.deposited;
    byCampaign.set(key, row);
  }

  return NextResponse.json({
    summary: summary(g.affiliate.id),
    referrals,
    campaigns: [...byCampaign.values()].sort(
      (a, b) => b.deposited - a.deposited,
    ),
    series: series(g.affiliate.id, 30).map((s) => ({
      date: s.date,
      signups: s.signups,
    })),
  });
}
