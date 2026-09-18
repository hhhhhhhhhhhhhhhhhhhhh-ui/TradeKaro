import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, liveToken } from "@/app/lib/authStore";
import { accountKey, ensureAccount } from "@/app/lib/tradingServer";
import { payinOrder, payinOrdersFor, startPayin } from "@/app/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Top up through the payment gateway.
//
// This is the honest successor to the self-service funding button: real money
// in, credited only when the gateway's signed callback says the payment
// settled. The browser never tells us an amount succeeded — it only asks for a
// checkout URL, and the ledger is written by the webhook.
//
// Nothing here is reachable while `payments.enabled` is off, which is the
// default.

async function me(req: NextRequest) {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const c = await liveToken(token);
  return c?.id ? { id: String(c.id), email: c.email } : null;
}

/** Where the gateway should call us back. Must be a public URL. */
function notifyBase(req: NextRequest) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim();
  return (configured || req.nextUrl.origin).replace(/\/+$/, "");
}

/** Recent gateway orders for this account, so the panel can show pending ones. */
export async function GET(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = accountKey(who.id);

  const orderId = req.nextUrl.searchParams.get("order");
  if (orderId) {
    const o = payinOrder(orderId);
    // Only its owner may read an order — an id is guessable-ish and this
    // carries an amount and a checkout URL.
    if (!o || o.user_id !== key)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ order: o });
  }

  return NextResponse.json({ orders: payinOrdersFor(key, 25) });
}

export async function POST(req: NextRequest) {
  const who = await me(req);
  if (!who)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as any);
  const key = accountKey(who.id);
  await ensureAccount(key);

  const method = ["upi", "bank", "usdt"].includes(String(body?.method))
    ? String(body.method)
    : "upi";

  const res = await startPayin({
    userId: key,
    amount: Number(body?.amount),
    method,
    customerEmail: who.email,
    // The provider matches the customer by email/phone on the hosted page; a
    // wrong notify_url silently breaks every callback, so it is built here
    // rather than accepted from the client.
    notifyUrl: `${notifyBase(req)}/api/payments/webhook/payin`,
  });

  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    ok: true,
    order: res.order,
    checkoutUrl: res.checkoutUrl,
  });
}
