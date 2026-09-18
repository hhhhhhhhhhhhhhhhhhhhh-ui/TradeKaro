import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { audit } from "@/app/lib/adminStore";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { sunpayConfig } from "@/app/lib/sunpay";
import { depositedTotal } from "@/app/lib/deposits";
import { accountKey, publicAccount } from "@/app/lib/tradingServer";
import { findDirectoryUser } from "@/app/lib/directory";
import { accountsFor, describeAccount } from "@/app/lib/payoutAccounts";
import {
  allWithdrawals,
  pendingWithdrawals,
  requestWithdrawal,
  withdrawalSummary,
  withdrawalRowsFor,
} from "@/app/lib/withdrawals";
import {
  gatewayBalance,
  payOutWithdrawal,
  paymentsStatus,
  payoutsFor,
  recentOrders,
  recentPayouts,
  recentWebhooks,
  reconciliation,
  rejectWithdrawal,
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

/**
 * Accounts still holding the old seeded practice capital.
 *
 * Zeroing the setting does not touch rows that were already written, so this is
 * the number that says how much withdrawable money is backed by nothing. It is
 * reported rather than fixed: rewriting a live balance is an operator's call.
 */
function seededAccounts() {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(start_cash), 0) AS total
         FROM trade_accounts WHERE start_cash > 0`,
    )
    .get() as { n: number; total: number } | undefined;
  return { count: Number(r?.n) || 0, total: Number(r?.total) || 0 };
}

/**
 * A withdrawal row plus the account it is headed to.
 *
 * The operator queue has to say WHERE the money is going in words an operator
 * can check at a glance, because that is the only thing standing between a
 * typo in a customer's saved account and a transfer to a stranger.
 */
function decorate(rows: any[]) {
  return rows.map((w) => {
    const acct = w.account_id
      ? (db
          .prepare("SELECT * FROM payout_accounts WHERE id = ?")
          .get(w.account_id) as any)
      : null;
    return {
      ...w,
      account: acct,
      destination: acct ? describeAccount(acct) : "account removed",
    };
  });
}

/**
 * How much this customer may withdraw right now.
 *
 * Read from `publicAccount`, so it is the same number the customer sees and the
 * same number the request was validated against — a queue that advertised a
 * different figure would have an operator approving things the ledger refuses.
 */
async function withdrawableFor(id: string): Promise<number> {
  const dir = await findDirectoryUser(id);
  if (!dir) return 0;
  const acct = await publicAccount(accountKey(id), dir.email);
  return Number(acct.withdrawable) || 0;
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
  const key = userId ? accountKey(userId) : "";

  return NextResponse.json({
    status,
    counts: counts(),
    // The whole book, so the Finance page can be the single place everything
    // about money is observed rather than one customer at a time.
    orders: recentOrders(100),
    payouts: recentPayouts(100),
    recon: reconciliation(),
    webhooks: recentWebhooks(60),
    balance: bal && bal.ok ? bal.data : null,
    balanceError: bal && !bal.ok ? bal.error : null,

    // ── withdrawals ──
    // Oldest first: an operator should work a queue, not a stack.
    queue: decorate(pendingWithdrawals(100)),
    withdrawals: decorate(allWithdrawals(200)),
    withdrawalSummary: withdrawalSummary(),
    /** Virtual capital that was seeded before the switch to real money. */
    seeded: seededAccounts(),

    // Per-client funding, payout and withdrawal history, for the drawer.
    user: userId
      ? {
          id: userId,
          deposited: depositedTotal(key),
          payouts: payoutsFor(key, 25),
          withdrawals: decorate(withdrawalRowsFor(key, 25)),
          accounts: (accountsFor(key) || []).map((x) => ({
            ...x,
            description: describeAccount(x),
          })),
          withdrawable: await withdrawableFor(userId),
        }
      : null,
  });
}

/**
 * Operator actions.
 *
 *   { action: "approve", id }                     — pay a pending request
 *   { action: "reject",  id, reason }             — turn it down, release funds
 *   { action: "manual",  id, amount, accountId }  — create and pay in one step,
 *        for a customer who asked off-platform. Still lands in the withdrawal
 *        ledger, so the balance moves either way and the books cannot drift.
 */
export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}) as any);
  const action = String(body?.action || "approve").trim();
  const notifyUrl = `${String(
    process.env.PUBLIC_BASE_URL || new URL(req.url).origin,
  ).replace(/\/+$/, "")}/api/payments/webhook/payout`;

  const log = (act: string, detail: string) =>
    audit({
      at: Date.now(),
      adminId: a.user.id,
      email: a.user.email,
      action: act,
      detail,
      ip: req.headers.get("x-forwarded-for") || "local",
    });

  // ── reject ──
  if (action === "reject") {
    const res = rejectWithdrawal(
      String(body?.id || ""),
      a.user.email,
      String(body?.reason || ""),
    );
    if (!res.ok)
      return NextResponse.json({ error: res.error }, { status: res.status });
    await log("withdrawal.rejected", `${body.id} reason=${body.reason}`);
    return NextResponse.json({ ok: true, withdrawal: res.withdrawal });
  }

  // ── manual: create a withdrawal already approved, then pay it ──
  if (action === "manual") {
    const userId = String(body?.id || "");
    if (!userId)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!(await findDirectoryUser(userId)))
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const s = await runtimeSettings();
    const made = requestWithdrawal({
      userId: accountKey(userId),
      amount: Number(body?.amount),
      accountId: String(body?.accountId || ""),
      limits: {
        min: Number(s.payments?.minWithdraw) || 0,
        max: Number(s.payments?.maxWithdraw) || 0,
        withdrawable: await withdrawableFor(userId),
      },
      needsApproval: false,
      actor: a.user.email,
    });
    if (!made.ok)
      return NextResponse.json({ error: made.error }, { status: made.status });

    const paid = await payOutWithdrawal(
      made.withdrawal.id,
      a.user.email,
      notifyUrl,
    );
    if (!paid.ok) {
      await log("withdrawal.failed", `${made.withdrawal.id} ${paid.error}`);
      return NextResponse.json(
        { error: paid.error, ambiguous: paid.ambiguous === true },
        { status: paid.status },
      );
    }
    await log(
      "withdrawal.sent",
      `${made.withdrawal.id} user=${userId} amount=${made.withdrawal.amount}`,
    );
    return NextResponse.json({ ok: true, withdrawal: paid.withdrawal });
  }

  // ── approve ──
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const res = await payOutWithdrawal(id, a.user.email, notifyUrl);
  if (!res.ok) {
    await log("withdrawal.approve_failed", `${id} ${res.error}`);
    return NextResponse.json(
      { error: res.error, ambiguous: res.ambiguous === true },
      { status: res.status },
    );
  }
  await log("withdrawal.approved", `${id} paid`);
  return NextResponse.json({ ok: true, withdrawal: res.withdrawal });
}
