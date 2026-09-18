import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifyToken } from "@/app/lib/authStore";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import {
  accountKey,
  ensureAccount,
  publicAccount,
} from "@/app/lib/tradingServer";
import { accountsFor, describeAccount } from "@/app/lib/payoutAccounts";
import { requestWithdrawal, withdrawalRowsFor } from "@/app/lib/withdrawals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A customer asking for their money.
//
// Everything that decides whether this is allowed is computed here, on the
// server: how much is free (`deriveAccount` minus every withdrawal already
// asked for), the admin's min/max, and whether the destination account actually
// belongs to this user. The browser supplies an amount and an account id —
// nothing else, and nothing it could inflate.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await verifyToken(token);
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

  return NextResponse.json({
    withdrawals: withdrawalRowsFor(key, 50).map((w) => {
      const a = accountsFor(key).find((x) => x.id === w.account_id);
      return {
        ...w,
        destination: a ? describeAccount(a) : "account removed",
      };
    }),
    // The number the customer is allowed to act on, from the same ledger the
    // request will be validated against — so the form cannot offer an amount the
    // server then refuses.
    withdrawable: acct.withdrawable,
    freeMargin: acct.freeMargin,
    deposited: acct.deposited,
    withdrawn: acct.withdrawn,
    minWithdraw: Number(s.payments?.minWithdraw) || 0,
    maxWithdraw: Number(s.payments?.maxWithdraw) || 0,
    enabled:
      s.payments?.payoutsEnabled === true && s.payments?.enabled === true,
    kycEligible: acct.kycEligible,
    accounts: accountsFor(key).map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      isDefault: a.is_default === 1,
      description: describeAccount(a),
    })),
  });
}

export async function POST(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);
  await ensureAccount(key);

  const s = await runtimeSettings();
  if (s.payments?.enabled !== true || s.payments?.payoutsEnabled !== true)
    return NextResponse.json(
      { error: "Withdrawals are switched off" },
      { status: 503 },
    );

  const acct = await publicAccount(key, who.email);
  const body = await req.json().catch(() => ({}) as any);

  // KYC first: an unverified account asking a stranger to send money to a bank
  // account is the shape of every payout fraud, and the gate already exists.
  if (!acct.kycEligible)
    return NextResponse.json(
      {
        error: `Complete KYC before withdrawing — it unlocks at ₹${Number(
          acct.kycMinDeposit,
        ).toLocaleString("en-IN")} deposited.`,
      },
      { status: 403 },
    );

  const res = requestWithdrawal({
    userId: key,
    amount: Number(body?.amount),
    accountId: String(body?.accountId || ""),
    limits: {
      min: Number(s.payments?.minWithdraw) || 0,
      max: Number(s.payments?.maxWithdraw) || 0,
      withdrawable: acct.withdrawable,
    },
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  const a = accountsFor(key).find((x) => x.id === res.withdrawal.account_id);
  return NextResponse.json({
    ok: true,
    withdrawal: {
      ...res.withdrawal,
      destination: a ? describeAccount(a) : null,
    },
    // The new balance, so the panel updates without a second round trip.
    withdrawable: (await publicAccount(key, who.email)).withdrawable,
  });
}
