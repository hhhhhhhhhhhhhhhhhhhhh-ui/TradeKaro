import { NextRequest, NextResponse } from "next/server";
import { applyPayoutWebhook } from "@/app/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Payout callback. Same rules as the pay-in webhook — raw body first, exact
// bytes to the verifier — but verified against the PAYOUT secret, which is a
// separate key pair. Verifying pay-ins with the payout secret is a mistake that
// presents as "nothing ever confirms", so the two live in different files with
// different imports and neither can reach the other's secret by accident.
//
// Money out is only ever *confirmed* here. Nothing in this handler initiates a
// payment, so a forged callback cannot make us send anything — the worst a
// forgery achieves is a status update, and it cannot even do that without the
// secret.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-signature") || "";

  const res = await applyPayoutWebhook(raw, signature);

  return NextResponse.json(
    { ok: res.status === 200, outcome: res.outcome, note: res.note },
    { status: res.status },
  );
}
