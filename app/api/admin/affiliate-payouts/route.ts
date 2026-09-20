import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import { adminOverview, decidePayout, payoutQueue } from "@/app/lib/affiliates";
import { adminFrom, deny, needAdmin } from "../_guard";

// The affiliate pay-out queue.
//
// GET  ?status=requested|approved|paid|rejected|all
// POST { id, status: "approved" | "paid" | "rejected", utr?, note? }
//
// Nothing here transfers money, and that is the design: a UPI or USDT transfer is
// irreversible, so the console records a decision an operator has ALREADY made
// elsewhere. The route's whole job is to make that decision checkable later.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const status = new URL(req.url).searchParams.get("status") || "all";
  return NextResponse.json({
    queue: payoutQueue(status),
    overview: adminOverview(),
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const status = String(body?.status || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const res = decidePayout({
    id,
    status: status as "approved" | "paid" | "rejected",
    utr: body?.utr,
    note: body?.note,
    actor: a.user.email,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "affiliate.payout",
    detail: `${res.payout.id} ₹${res.payout.amount} -> ${res.payout.status}${
      res.payout.utr ? ` utr=${res.payout.utr}` : ""
    }${res.payout.note ? ` note="${res.payout.note}"` : ""}`,
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({
    ok: true,
    payout: res.payout,
    queue: payoutQueue("all"),
    overview: adminOverview(),
  });
}
