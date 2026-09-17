import { NextRequest, NextResponse } from "next/server";
import { heartbeat } from "@/app/lib/clientRegistry";

// Public heartbeat: browsers POST their own identity after login.
// Stores username/email/clientID + PAN last-4 + KYC + cash only.
// Never accepts or stores full PAN, passwords, or tokens.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cash =
    typeof body.cash === "number" && Number.isFinite(body.cash)
      ? Math.max(-1e12, Math.min(1e12, body.cash))
      : undefined;
  const rec = await heartbeat({
    username: body.username,
    email: body.email,
    clientID: body.clientID ?? body.clientId,
    panLast4: body.panLast4,
    kyc: body.kyc,
    cash,
  });
  if (!rec)
    // Nothing to record — browsers without an identity (e.g. the admin
    // console, which has its own session but no client account) hit this.
    // It is not an error, so don't answer 400: that spammed the dev log and
    // cost a round trip on every such page load.
    return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    ok: true,
    frozen: rec.status === "FROZEN",
    kyc: rec.kyc,
  });
}
