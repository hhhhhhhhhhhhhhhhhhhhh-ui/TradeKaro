import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import {
  adminOverview,
  affiliateAdminDetail,
  COMMISSION_MODELS,
  decideAffiliate,
  listAffiliatesAdmin,
  plans,
} from "@/app/lib/affiliates";
import { adminFrom, deny, needAdmin } from "../_guard";

// Operator endpoints for the affiliate programme.
//
// GET             → the directory plus the section's headline figures
// GET ?id=        → everything about one affiliate, for the drawer
// POST { action: "decide", id, status?, planId?, model?, depositRate?,
//        revRate?, note?, rejectReason? }  — operator+
//
// Every write goes through `decideAffiliate` in app/lib/affiliates.ts, which
// validates the status and applies any terms change in ONE statement. Splitting
// "approve" and "set the rate" into two requests would allow the state this
// console must never reach: an approved partner whose rate was never set.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const detail = affiliateAdminDetail(id);
    if (!detail)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...detail, plans: plans() });
  }

  const status = url.searchParams.get("status") || "all";
  const q = url.searchParams.get("q") || "";
  return NextResponse.json({
    affiliates: listAffiliatesAdmin(status, q),
    plans: plans(),
    // Sent with the list rather than fetched separately: the header figures and
    // the rows are read together, and two requests can disagree by one approval.
    overview: adminOverview(),
  });
}

/**
 * Parse a rate override.
 *
 *   undefined → leave whatever is stored
 *   null / "" → CLEAR the override, so the affiliate reverts to their plan
 *   number    → set it
 *
 * A number outside 0–100 is an ERROR, not a clear. The first version of this
 * returned `null` for an out-of-range value, so a typo of `500` quietly erased a
 * negotiated rate instead of being refused — and "silently inherits the plan" is
 * the one outcome nobody would ever notice. `mutateClient` guards its own
 * override for the same reason.
 */
function parseRate(
  v: unknown,
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}));
  if (String(body?.action || "") !== "decide")
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const status = body?.status === undefined ? undefined : String(body.status);
  if (
    status !== undefined &&
    !["pending", "approved", "rejected", "suspended"].includes(status)
  )
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });

  // A rejection reason is shown to the applicant, so it cannot be blank — the
  // same rule the payout rejection path enforces.
  const rejectReason = String(body?.rejectReason || "").trim();
  if (status === "rejected" && !rejectReason)
    return NextResponse.json(
      {
        error:
          'Add a reason — the applicant sees it, and a bare "rejected" is not an answer',
      },
      { status: 400 },
    );

  const model = body?.model === undefined ? undefined : body.model || null;
  // Validated against the one exported list rather than a copy of it, so the
  // console, the validator and the engine can never disagree about what a
  // commission model is. There is no CPA model to accept.
  if (
    model !== undefined &&
    model !== null &&
    !COMMISSION_MODELS.includes(String(model) as any)
  )
    return NextResponse.json(
      { error: "Unknown commission model" },
      { status: 400 },
    );

  const dep = parseRate(body?.depositRate);
  const rev = parseRate(body?.revRate);
  if (!dep.ok || !rev.ok)
    return NextResponse.json(
      { error: "A commission rate must be a number between 0 and 100" },
      { status: 400 },
    );

  const res = decideAffiliate({
    id,
    status,
    planId: body?.planId === undefined ? undefined : body.planId || null,
    model,
    depositRate: dep.value,
    revRate: rev.value,
    note: body?.note === undefined ? undefined : body.note,
    rejectReason: body?.rejectReason === undefined ? undefined : rejectReason,
    actor: a.user.email,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "affiliate.decide",
    detail: `${res.affiliate.code} (${res.affiliate.email}) ${status || ""}${
      model !== undefined ? ` model=${model ?? "inherit"}` : ""
    }${body?.planId ? ` plan=${body.planId}` : ""}${
      dep.value !== undefined ? ` deposit=${dep.value ?? "inherit"}` : ""
    }${rev.value !== undefined ? ` rev=${rev.value ?? "inherit"}` : ""}${
      rejectReason ? ` reason="${rejectReason}"` : ""
    }`.trim(),
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({
    ok: true,
    affiliate: res.affiliate,
    detail: affiliateAdminDetail(id),
  });
}
