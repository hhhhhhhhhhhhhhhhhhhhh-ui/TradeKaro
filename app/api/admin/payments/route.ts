import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { audit } from "@/app/lib/adminStore";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { sunpayConfig } from "@/app/lib/sunpay";
import { depositedTotal } from "@/app/lib/deposits";
import { accountKey } from "@/app/lib/tradingServer";
import {
  gatewayBalance,
  paymentsStatus,
  payoutsFor,
  recentWebhooks,
  startPayout,
} from "@/app/lib/payments";
import { adminFrom, deny, needAdmin } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator view of the payment rail: what is configured, what the gateway says
// we hold, what came in, and — importantly — what the gateway told us that we
// could not act on. A rejected signature or an unknown order id is invisible
// everywhere else, and those are exactly the rows that explain a customer's
// "I paid and nothing happened".

function counts() {
  const orders = db
    .prepare(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
         FROM payment_orders GROUP BY status`,
    )
    .all() as { status: string; n: number; total: number }[];
  const webhooks = db
    .prepare(
      "SELECT outcome, COUNT(*) AS n FROM payment_webhooks GROUP BY outcome",
    )
    .all() as { outcome: string; n: number }[];
  return { orders, webhooks };
}

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();

  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);
  const [status, bal] = await Promise.all([
    paymentsStatus(),
    cfg.enabled && cfg.payoutApiKey && cfg.payoutApiSecret
      ? gatewayBalance(cfg)
      : Promise.resolve(null),
  ]);

  const userId = new URL(req.url).searchParams.get("id") || "";

  return NextResponse.json({
    status,
    counts: counts(),
    webhooks: recentWebhooks(60),
    balance: bal && bal.ok ? bal.data : null,
    balanceError: bal && !bal.ok ? bal.error : null,
    // Per-client funding and payout history, for the Users & KYC drawer.
    user: userId
      ? {
          id: userId,
          deposited: depositedTotal(accountKey(userId)),
          payouts: payoutsFor(accountKey(userId), 25),
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}) as any);
  const id = String(body?.id || body?.userId || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const userId = accountKey(id);
  const deposited = depositedTotal(userId);

  const method = ["upi", "bank"].includes(String(body?.method))
    ? String(body.method)
    : "upi";

  const res = await startPayout({
    userId,
    amount: Number(body?.amount),
    method,
    beneficiaryName: String(body?.beneficiaryName || "").trim(),
    beneficiaryAccount: String(body?.beneficiaryAccount || "").trim(),
    beneficiaryPhone: String(body?.beneficiaryPhone || "").trim() || undefined,
    ifsc: String(body?.ifsc || "").trim() || undefined,
    bankName: String(body?.bankName || "").trim() || undefined,
    actor: a.user.email,
    deposited,
    notifyUrl: `${String(
      process.env.PUBLIC_BASE_URL || new URL(req.url).origin,
    ).replace(/\/+$/, "")}/api/payments/webhook/payout`,
  });

  if (!res.ok) {
    await audit({
      at: Date.now(),
      adminId: a.user.id,
      email: a.user.email,
      action: "payout.rejected",
      detail: `user=${id} amount=${body?.amount} reason=${res.error}`,
      ip: req.headers.get("x-forwarded-for") || "local",
    });
    return NextResponse.json({ error: res.error }, { status: res.status });
  }

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "payout.sent",
    detail: `user=${id} payout=${res.payout.payout_id} amount=${res.payout.amount} method=${method}`,
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({ ok: true, payout: res.payout });
}
