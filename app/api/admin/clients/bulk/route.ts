import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import { mutateClient } from "@/app/lib/clientRegistry";
import { getDirectory } from "@/app/lib/directory";
import { adminFrom, deny, needAdmin } from "../../_guard";

const KYC_PATCH = ["VERIFIED", "PENDING", "REJECTED"];

// POST { ids: string[], status?: "ACTIVE" | "FROZEN", kyc?: string }
//
// Bulk freeze / unfreeze / KYC update for the client directory. Applies one
// row at a time (so a bad id cannot abort the batch), then writes a single
// audit entry summarising the operation.
export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  const status = body?.status ? String(body.status).toUpperCase() : undefined;
  const kyc = body?.kyc ? String(body.kyc).toUpperCase() : undefined;

  if (!ids.length)
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  if (ids.length > 500)
    return NextResponse.json(
      { error: "Too many ids in one batch (max 500)" },
      { status: 400 },
    );
  if (!status && !kyc)
    return NextResponse.json(
      { error: "Nothing to change — pass status and/or kyc" },
      { status: 400 },
    );
  if (status && !["ACTIVE", "FROZEN"].includes(status))
    return NextResponse.json(
      { error: "status must be ACTIVE or FROZEN" },
      { status: 400 },
    );
  if (kyc && !KYC_PATCH.includes(kyc))
    return NextResponse.json(
      { error: `kyc must be one of ${KYC_PATCH.join(", ")}` },
      { status: 400 },
    );

  const failed: string[] = [];
  let updated = 0;
  const statusPatch =
    status === "ACTIVE" || status === "FROZEN" ? status : undefined;
  // Ids come from the merged directory, which includes accounts that have never
  // checked in — seed lets mutateClient create the missing row for them.
  const seedById = new Map((await getDirectory()).map((u) => [u.id, u]));
  for (const id of ids) {
    try {
      const d = seedById.get(id);
      const rec = await mutateClient(
        id,
        { status: statusPatch, kyc },
        d
          ? {
              username: d.username,
              email: d.email,
              clientID: d.clientID || id,
            }
          : undefined,
      );
      if (rec) updated++;
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "client.bulk_update",
    detail: `${updated}/${ids.length} updated · ${status || "-"} ${kyc || "-"}`,
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({
    ok: true,
    updated,
    failed: failed.length,
    failedIds: failed.slice(0, 20),
  });
}
