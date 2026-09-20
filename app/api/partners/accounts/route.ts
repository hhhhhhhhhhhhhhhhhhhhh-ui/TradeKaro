import { NextRequest, NextResponse } from "next/server";
import {
  addPayoutAccount,
  payoutAccounts,
  removePayoutAccount,
  setDefaultPayoutAccount,
} from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET  /api/partners/accounts — payout destinations
// POST /api/partners/accounts — add one, set a default, or remove one
//
// Bank account numbers are stored as the last four digits only. A payout run
// needs the tail to confirm the right account was credited; it does not need the
// full number sitting in a database that also serves the trading app.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  return NextResponse.json({ accounts: payoutAccounts(g.affiliate.id) });
}

export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "add");

  if (action === "add") {
    const res = addPayoutAccount({
      affiliateId: g.affiliate.id,
      kind: body?.kind,
      label: body?.label,
      holder: body?.holder,
      upiId: body?.upiId,
      accountNumber: body?.accountNumber,
      ifsc: body?.ifsc,
      bankName: body?.bankName,
      usdtAddress: body?.usdtAddress,
      usdtNetwork: body?.usdtNetwork,
      makeDefault: !!body?.makeDefault,
    });
    if (!res.ok)
      return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, accounts: res.accounts });
  }

  if (action === "default") {
    const res = setDefaultPayoutAccount(g.affiliate.id, String(body?.id || ""));
    return NextResponse.json(res);
  }

  if (action === "remove") {
    const res = removePayoutAccount(g.affiliate.id, String(body?.id || ""));
    if (!res.ok)
      return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
