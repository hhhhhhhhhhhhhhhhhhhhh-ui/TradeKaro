import { NextRequest, NextResponse } from "next/server";
import { setClickConsent } from "@/app/lib/affiliates";

// POST /api/track/consent
//
// The second half of a click. The click row is written the instant the landing
// page renders — which is necessarily BEFORE the visitor has answered the
// banner — so at that moment there is no decision to store. This endpoint is
// what the banner calls once they choose.
//
// The click is identified by the short-lived `tc_cid` cookie the click endpoint
// set. Deliberately not by a body field: if the client could name which click to
// update, it could name someone else's.
//
// Two things this refuses to do, both of them the difference between a record
// and a fiction:
//
//   • It will not downgrade `exempt`. A visitor from a jurisdiction that owes no
//     banner is already permitted; a stray answer must not turn them into a
//     refusal.
//   • `setClickConsent` only fills a blank, so an existing answer stands. A
//     replayed request cannot flip a recorded refusal into permission.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision;

  if (decision !== "granted" && decision !== "denied")
    return NextResponse.json(
      { ok: false, error: "decision must be granted or denied" },
      { status: 400 },
    );

  const raw = req.cookies.get("tc_cid")?.value || "";
  const clickId = Number.parseInt(raw, 10);

  // No id is not an error: a visitor can open a landing page with no affiliate
  // code, in which case no click row exists and there is nothing to update. The
  // cookie still does its job of silencing the banner.
  if (!Number.isFinite(clickId) || clickId <= 0)
    return NextResponse.json({ ok: true, updated: false, reason: "no_click" });

  const updated = setClickConsent(clickId, decision);
  return NextResponse.json({
    ok: true,
    updated,
    reason: updated ? undefined : "already_set",
  });
}
