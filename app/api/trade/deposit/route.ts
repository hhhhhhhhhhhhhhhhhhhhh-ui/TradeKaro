import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifyToken } from "@/app/lib/authStore";
import {
  accountKey,
  ensureAccount,
  publicAccount,
} from "@/app/lib/tradingServer";
import {
  MAX_SINGLE_DEPOSIT,
  depositsFor,
  recordDeposit,
} from "@/app/lib/deposits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-service funding.
//
// An earlier version of this app had an ADD button in the Funds panel that
// wrote straight to localStorage. It was removed because the server never saw
// the money — you could type in ₹10,00,00,000 and the ledger happily ignored
// it, which made every downstream number a lie.
//
// This route is the honest version of that button: the amount is validated and
// appended to the server-side deposit ledger, and because deposits are part of
// trading capital it actually buys trading room. It is also what the KYC
// requirement is measured against.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await verifyToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

/** Deposit history + current standing, for the Funds panel. */
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

  const body = await req.json().catch(() => ({}));
  const key = accountKey(who.id);
  await ensureAccount(key);

  const res = recordDeposit({
    key,
    amount: Number(body?.amount),
    method: "self",
    note: typeof body?.note === "string" ? body.note : null,
    idem: typeof body?.idem === "string" ? body.idem : null,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    ok: true,
    duplicate: res.duplicate,
    deposited: res.total,
    account: await publicAccount(key, who.email),
  });
}
