import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  getSessions,
  getUsers,
  hashPass,
  newSalt,
  saveSessions,
  saveUsers,
} from "@/app/lib/adminStore";
import { adminFrom, deny, needAdmin } from "../_guard";
import { randomBytes } from "crypto";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "superadmin")) return deny();
  const users = await getUsers();
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      lockedUntil: u.lockedUntil || 0,
      totp: Boolean(u.totpSecret),
    })),
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "superadmin")) return deny();
  const {
    email = "",
    password = "",
    role = "viewer",
  } = await req.json().catch(() => ({}));
  const em = String(email).toLowerCase().trim();
  if (!em || String(password).length < 8)
    return NextResponse.json(
      { error: "Email + 8-char password required" },
      { status: 400 },
    );
  const users = await getUsers();
  if (users.some((u) => u.email === em))
    return NextResponse.json({ error: "Exists" }, { status: 400 });
  const salt = newSalt();
  users.push({
    id: randomBytes(8).toString("hex"),
    email: em,
    passHash: hashPass(String(password), salt),
    salt,
    role: role === "superadmin" || role === "operator" ? role : "viewer",
    createdAt: Date.now(),
    failCount: 0,
  });
  await saveUsers(users);
  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "admin.create",
    detail: em,
  });
  return NextResponse.json({ ok: true });
}

// DELETE ?id=<id> — remove a console operator (superadmin only).
//
// Two refusals are load-bearing: deleting yourself would revoke the session you
// are holding, and deleting the last remaining superadmin would leave a console
// that nobody can administer. Both are checked before anything is written.
export async function DELETE(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "superadmin")) return deny();

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === a.user.id)
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 },
    );

  const users = await getUsers();
  const target = users.find((u) => u.id === id);
  if (!target)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const superadmins = users.filter((u) => u.role === "superadmin").length;
  if (target.role === "superadmin" && superadmins <= 1)
    return NextResponse.json(
      { error: "Cannot delete the last superadmin" },
      { status: 400 },
    );

  await saveUsers(users.filter((u) => u.id !== id));

  // Their sessions would otherwise outlive the account and keep resolving
  // against a user row that no longer exists.
  const sessions = await getSessions();
  const keep = sessions.filter((s) => s.adminId !== id);
  const revoked = sessions.length - keep.length;
  if (revoked > 0) await saveSessions(keep);

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "admin.delete",
    detail: target.email,
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({ ok: true, revoked });
}
