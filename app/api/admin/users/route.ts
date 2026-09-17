import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  getUsers,
  hashPass,
  newSalt,
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
