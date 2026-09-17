import { NextRequest, NextResponse } from "next/server";
import { adminFrom, deny, needAdmin } from "../_guard";
import { audit } from "@/app/lib/adminStore";
import { sweepMisSquareOff } from "@/app/lib/tradingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/mis-sweep — run the intraday square-off right now.
//
// The sweep normally fires on its own timer at the cutoff (see
// `sweepMisSquareOff`), throttled to once a minute. This is the operator's
// manual override: useful when a position needs clearing immediately, and the
// only way to observe the sweep without waiting for the cutoff.
//
// It deliberately does NOT bypass the due check — if the cutoff has not passed
// the sweep has nothing to do, and it says so rather than closing positions the
// customer is still entitled to hold.
export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const result = await sweepMisSquareOff().catch((e) => ({
    swept: 0,
    unpriced: 0,
    why: `sweep failed: ${e?.message || "unknown"}`,
  }));

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "mis.squareoff.manual",
    detail: `${result.swept} leg(s), ${result.unpriced} unpriced — ${result.why}`,
    ip: req.headers.get("x-forwarded-for") || "local",
  }).catch(() => {});

  return NextResponse.json({ ok: true, ...result });
}
