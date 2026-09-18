import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, liveToken } from "@/app/lib/authStore";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import {
  accountKey,
  ensureAccount,
  publicAccount,
} from "@/app/lib/tradingServer";
import { depositsFor } from "@/app/lib/deposits";
import { accountsFor, describeAccount } from "@/app/lib/payoutAccounts";
import { withdrawalRowsFor, withdrawalSummary } from "@/app/lib/withdrawals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The wallet: everything a customer needs to move their own money, in one read.
//
// One endpoint rather than four on purpose. The balance, the deposit history,
// the withdrawal history, the saved destinations and the limits all describe a
// single thing, and fetching them separately means the page can render a
// balance that disagrees with the list underneath it — which is exactly the
// class of mismatch that makes people distrust a money screen.
//
// The numbers here are the SAME numbers the write paths validate against:
// `publicAccount` derives the wallet, `/api/withdrawals` spends it, and the
// gateway deposit credits it. Nothing on this page is computed in the browser.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  // `liveToken`, not `verifyToken`: a signed session whose account no longer
  // exists must be refused, not served an empty wallet.
  const c = await liveToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

export async function GET(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = accountKey(who.id);
  await ensureAccount(key);

  const s = await runtimeSettings();
  const acct = await publicAccount(key, who.email);
  const pay = s.payments;

  const gate =
    pay?.enabled === true
      ? "on"
      : pay?.payoutsEnabled === true
        ? "payout_only"
        : "off";

  return NextResponse.json({
    // ── the balance ──
    walletBalance: acct.walletBalance,
    withdrawable: acct.withdrawable,
    /** Real money in, ever: gateway + operator credits. */
    deposited: acct.walletDeposited,
    /** Asked for, approved, in flight or paid — i.e. no longer in the wallet. */
    withdrawn: acct.withdrawn,
    /** Practice credits: tradeable, deliberately not withdrawable. */
    practiceCredit: acct.practiceCredit,
    tradingCapital: acct.tradingCapital,
    freeMargin: acct.freeMargin,
    /** Only the free part of the wallet may be asked for. */
    summary: withdrawalSummary(),

    // ── what the customer may do ──
    deposit: {
      /** `off` | `payout_only` | `on` — the deposit side needs `on`. */
      state: gate,
      enabled: pay?.enabled === true,
      minAmount: Number(pay?.minAmount) || 0,
      maxAmount: Number(pay?.maxAmount) || 0,
    },
    withdraw: {
      enabled: pay?.enabled === true && pay?.payoutsEnabled === true,
      min: Number(pay?.minWithdraw) || 0,
      max: Number(pay?.maxWithdraw) || 0,
    },

    // ── KYC, as it applies to WITHDRAWING ──
    kyc: {
      eligible: acct.kycEligible,
      required: acct.withdrawKycRequired,
      source: acct.withdrawKycSource,
      minDeposit: acct.kycMinDeposit,
      remaining: acct.kycRemaining,
      /** True when the KYC requirement is what stands between them and a payout. */
      blocked: acct.withdrawKycRequired && !acct.kycEligible,
    },

    // ── destinations ──
    accounts: accountsFor(key).map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      isDefault: a.is_default === 1,
      description: describeAccount(a),
      createdAt: a.created_at,
    })),

    // ── history ──
    deposits: depositsFor(key, 50).map((d) => ({
      id: d.id,
      ts: d.ts,
      amount: d.amount,
      method: d.method,
      note: d.note,
    })),
    withdrawals: withdrawalRowsFor(key, 50).map((w) => {
      const a = accountsFor(key).find((x) => x.id === w.account_id);
      return {
        ...w,
        destination: a ? describeAccount(a) : "account removed",
      };
    }),
  });
}
