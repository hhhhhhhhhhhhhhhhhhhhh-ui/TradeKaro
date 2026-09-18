import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import { mutateClient } from "@/app/lib/clientRegistry";
import { findDirectoryUser } from "@/app/lib/directory";
import { depositsFor, recordDeposit } from "@/app/lib/deposits";
import { adminFrom, deny, needAdmin } from "../_guard";

// GET ?id= — single client detail for the drawer. Reads the merged directory,
// so it resolves for accounts that have never checked in.
// POST { id, status?, kyc?, note?, marginPct?, deposit? } — operator+.
//
// `deposit` credits the user's funding ledger. It is the manual half of the
// deposit system (the user can also fund themselves via POST /api/trade/
// deposit), and it is what the KYC requirement is measured against.
export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const id = new URL(req.url).searchParams.get("id") || "";
  const c = await findDirectoryUser(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    user: c,
    deposits: depositsFor(`u-${id}`, 20),
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const dir = await findDirectoryUser(id);
  if (!dir) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rec = await mutateClient(
    id,
    {
      status: body.status,
      kyc: body.kyc,
      note: body.note,
      marginPct: body.marginPct,
      // "" clears the override back to `inherit`; a junk value is refused by
      // mutateClient rather than stored as something that reads as inherit.
      withdrawKyc: body.withdrawKyc,
    },
    { username: dir.username, email: dir.email, clientID: dir.clientID || id },
  );
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Deposits are money, so they get their own validated ledger entry rather
  // than riding along in the client record where a partial write could lose
  // them. Only credited when an amount is actually supplied.
  let deposited: number | null = null;
  if (
    body.deposit !== undefined &&
    body.deposit !== null &&
    body.deposit !== ""
  ) {
    const res = recordDeposit({
      key: `u-${id}`,
      amount: Number(body.deposit),
      method: "admin",
      actor: a.user.email,
      note: typeof body.depositNote === "string" ? body.depositNote : null,
    });
    if (!res.ok)
      return NextResponse.json({ error: res.error }, { status: res.status });
    deposited = res.total;
  }

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "client.update",
    detail: `${id} ${body.status || ""} ${body.kyc || ""}${
      body.marginPct !== undefined ? ` margin=${body.marginPct}%` : ""
    }${
      body.withdrawKyc ? ` withdrawKyc=${String(body.withdrawKyc)}` : ""
    }${body.deposit ? ` deposit=+₹${Number(body.deposit)}` : ""}`.trim(),
    ip: req.headers.get("x-forwarded-for") || "local",
  });
  // Return the merged view so the drawer keeps phone / neverLoggedIn in sync.
  const fresh = await findDirectoryUser(id);
  return NextResponse.json({
    ok: true,
    user: fresh || rec,
    deposited,
    deposits: depositsFor(`u-${id}`, 20),
  });
}
