import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import { reconcileCommissions } from "@/app/lib/affiliates";
import { adminFrom, deny, needAdmin } from "../_guard";

// GET  ?affiliateId=&limit=  → DRY RUN. What is wrong, changing nothing.
// POST { apply?: true }      → also repairs what can be repaired.
//
// Reconciliation is the only part of this system that does not assume a write
// succeeded. It recomputes what every partner is owed from the deposits that
// actually arrived and the terms that were actually in force, then compares that
// against the commission ledger.
//
// Read-only by default on purpose. `apply` moves money: a repaired row for an
// old deposit is already past its holdback, so applying a large backlog releases
// real money in one call. That should be a deliberate act, not a side effect of
// opening a page — and every applied run is written to the audit log.
export const dynamic = "force-dynamic";

function parse(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return {
    affiliateId: sp.get("affiliateId") || undefined,
    limit: Number(sp.get("limit")) || undefined,
  };
}

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  return NextResponse.json(reconcileCommissions(parse(req)));
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}));
  const { affiliateId, limit } = parse(req);
  const apply = body?.apply === true;

  const report = reconcileCommissions({
    affiliateId: body?.affiliateId || affiliateId,
    limit: Number(body?.limit) || limit,
    apply,
  });

  if (apply)
    await audit({
      at: Date.now(),
      adminId: a.user.id,
      email: a.user.email,
      action: "affiliate.reconcile",
      detail: [
        `mode=${report.mode}`,
        `scanned=${report.depositsScanned} deposits`,
        `missing=${report.missing} (₹${report.missingAmount})`,
        `repaired=${report.repaired} (₹${report.repairedAmount})`,
        `mismatched=${report.mismatched}`,
        `orphaned=${report.orphaned}`,
        `drifted=${report.drifted}`,
      ].join(" "),
      ip: req.headers.get("x-forwarded-for") || "local",
    });

  return NextResponse.json(report);
}
