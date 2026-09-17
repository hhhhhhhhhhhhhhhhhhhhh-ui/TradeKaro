import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifyToken } from "@/app/lib/authStore";
import {
  accountKey,
  commitFill,
  ensureAccount,
  logReject,
  publicAccount,
  validateFill,
} from "@/app/lib/tradingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only way a fill can enter the ledger. Nothing here trusts the
// client beyond the intent to trade; price, cash and holdings are all checked
// server-side (see app/lib/tradingServer.ts).

async function claims(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await verifyToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

export async function GET(req: NextRequest) {
  const me = await claims(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(me.id);
  await ensureAccount(key);
  return NextResponse.json({ account: await publicAccount(key, me.email) });
}

export async function POST(req: NextRequest) {
  const me = await claims(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = accountKey(me.id);
  await ensureAccount(key);

  const input = {
    symbol: String(body?.symbol || ""),
    kind: body?.kind === "OPTION" ? ("OPTION" as const) : ("STOCK" as const),
    side: body?.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
    qty: Number(body?.qty),
    price: Number(body?.price),
    product: body?.product === "MIS" ? ("MIS" as const) : ("CNC" as const),
    idem: typeof body?.idem === "string" ? body.idem : undefined,
    ts: Number(body?.ts) || Date.now(),
    meta: {
      underlying: body?.underlying,
      expiry: body?.expiry,
      strike: Number(body?.strike) || undefined,
      optionSide:
        body?.optionSide === "CE" || body?.optionSide === "PE"
          ? body.optionSide
          : undefined,
      lotSize: Number(body?.lotSize) || undefined,
    },
  };

  const verdict = await validateFill(key, input, me.email);
  if (!verdict.ok) {
    // Record the refusal before answering. Without this the validator's reason
    // was returned to the browser and thrown away, so there was no way to tell
    // why orders fail or which guard is doing the rejecting.
    logReject({
      userId: key,
      reason: verdict.reason,
      symbol: input.symbol,
      kind: input.kind,
      side: input.side,
      qty: input.qty,
      price: input.price,
      status: verdict.status,
      detail: verdict.error,
    });
    // Return the authoritative account alongside the error so the client can
    // snap its optimistic UI back to the truth in one round trip.
    return NextResponse.json(
      { error: verdict.error, account: await publicAccount(key, me.email) },
      { status: verdict.status },
    );
  }

  if (!verdict.duplicate)
    commitFill(key, input, verdict.refPrice, verdict.charges);
  return NextResponse.json({
    ok: true,
    account: await publicAccount(key, me.email),
  });
}
