import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifyToken } from "@/app/lib/authStore";
import {
  accountKey,
  ensureAccount,
  publicAccount,
} from "@/app/lib/tradingServer";
import { MAX_SINGLE_DEPOSIT, depositsFor } from "@/app/lib/deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Deposits: no user-facing writer ─────────────────────────────────────────
//
// ⚠️ POST used to credit the ledger directly ("self-service funding"). That is
// removed, deliberately and permanently, because a deposit drives BOTH trading
// capital and the KYC requirement — so a signed-in user could credit themselves
// ₹5,00,000 at a time, clear the ₹25,000 KYC threshold in one click, and then
// ask for a real withdrawal that Sunpay would really pay. Money in has to come
// from money in.
//
// Deposits now have exactly two writers, both server-side and neither of them
// reachable by a customer:
//
//   * a VERIFIED Sunpay callback   — POST /api/payments/webhook/payin
//   * an operator credit           — POST /api/admin/clients
//
// `recordDeposit` refuses `method: "self"` as well, so this cannot be reopened
// by a future caller. GET stays: the wallet shows the history.
//
// The remaining version of this route is a signpost, not an error to be
// debugged — it says where to go instead.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await verifyToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

/** Deposit history + current standing. */
export async function GET(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);
  await ensureAccount(key);
  const account = await publicAccount(key, who.email);
  return NextResponse.json({
    account,
    deposits: depositsFor(key, 50),
    maxSingle: MAX_SINGLE_DEPOSIT,
  });
}

export async function POST(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    {
      error:
        "Direct deposits are disabled. Add funds from your wallet — the balance " +
        "is credited only once the payment gateway confirms it.",
      wallet: "/wallet",
    },
    { status: 410 },
  );
}
