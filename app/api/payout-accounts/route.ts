import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, liveToken } from "@/app/lib/authStore";
import { accountKey, ensureAccount } from "@/app/lib/tradingServer";
import {
  accountInUse,
  accountsFor,
  addAccount,
  describeAccount,
  importDeviceAccounts,
  removeAccount,
  setDefaultAccount,
} from "@/app/lib/payoutAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where this customer wants money sent. UPI or bank, server-side.
//
// The server never accepts a beneficiary at withdrawal time — the browser picks
// an ID from this list, and the list is the only thing the payout can use. That
// is the whole point of moving it off the device: a beneficiary supplied by the
// client is precisely the field an attacker would change.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await liveToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

/** The client shape: `description` is pre-masked for display. */
function shape(list: ReturnType<typeof accountsFor>) {
  return list.map((a) => ({
    id: a.id,
    kind: a.kind,
    label: a.label,
    holderName: a.holder_name,
    upiId: a.upi_id,
    // Never the full number back to the browser. It is the owner's own data, but
    // it has no reason to sit in a DOM, a screenshot or a log line.
    accountNumberTail: a.account_number
      ? `••••${String(a.account_number).slice(-4)}`
      : null,
    ifsc: a.ifsc,
    bankName: a.bank_name,
    isDefault: a.is_default === 1,
    description: describeAccount(a),
  }));
}

export async function GET(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);
  await ensureAccount(key);
  return NextResponse.json({ accounts: shape(accountsFor(key)) });
}

export async function POST(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);
  await ensureAccount(key);

  const body = await req.json().catch(() => ({}) as any);
  const action = String(body?.action || "add");

  if (action === "default") {
    const ok = setDefaultAccount(key, String(body?.id || ""));
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, accounts: shape(accountsFor(key)) });
  }

  if (action === "import") {
    // One-time promotion of the old device-only list. Skipped silently if this
    // account already has server-side entries, so a customer who adds an account
    // on one device does not get their browser copy merged in on another.
    const res = importDeviceAccounts(key, body?.accounts);
    return NextResponse.json({
      ok: true,
      ...res,
      accounts: shape(accountsFor(key)),
    });
  }

  const res = addAccount(key, {
    kind: String(body?.kind || ""),
    label: body?.label,
    holderName: body?.holderName,
    upiId: body?.upiId,
    accountNumber: body?.accountNumber,
    ifsc: body?.ifsc,
    bankName: body?.bankName,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, accounts: shape(accountsFor(key)) });
}

export async function DELETE(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // An account named on a live withdrawal cannot vanish — the operator would be
  // left holding a payout with nowhere to send it.
  if (accountInUse(id))
    return NextResponse.json(
      {
        error:
          "This account is used by a withdrawal that is still in progress. Try again once it finishes.",
      },
      { status: 409 },
    );

  if (!removeAccount(key, id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rest = accountsFor(key);
  // Never leave a user with accounts but no default.
  if (rest.length && !rest.some((a) => a.is_default === 1))
    setDefaultAccount(key, rest[0].id);

  return NextResponse.json({ ok: true, accounts: shape(accountsFor(key)) });
}
