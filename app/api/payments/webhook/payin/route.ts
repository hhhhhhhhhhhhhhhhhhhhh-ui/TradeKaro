import { NextRequest, NextResponse } from "next/server";
import { applyPayinWebhook } from "@/app/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pay-in callback. The only path in this app that turns a gateway event into
// money, so it is deliberately suspicious of everything.
//
// ⚠️ `await req.text()` FIRST, and hand those exact bytes to the verifier. The
// signature is HMAC over the raw body, so the moment you `await req.json()` the
// bytes are gone and no signature can ever match — the single most common way
// this integration fails, and it fails as "every callback is rejected" rather
// than as anything that points at the cause.
//
// Responses: the provider retries on anything that is not HTTP 200, up to 200
// times. So a 401 is only for a genuinely bad signature (retrying a forgery is
// harmless), while an event we cannot act on — an order we do not know — gets a
// 200, because retrying will not make it known and 200 retries of a logged
// mystery is worse than one.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-signature") || "";

  const res = await applyPayinWebhook(raw, signature);

  // Never echo the body back; it contains the customer's UPI id and UTR.
  return NextResponse.json(
    { ok: res.status === 200, outcome: res.outcome, note: res.note },
    { status: res.status },
  );
}
