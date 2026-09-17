import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  ensureBootstrapAdmin,
  getSessions,
  getUsers,
  hashPass,
  newToken,
  safeEqual,
  saveSessions,
  saveUsers,
} from "@/app/lib/adminStore";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAIL = 5;
const hits = new Map<string, number[]>();

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function throttled(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (throttled(ip))
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  const {
    email = "",
    password = "",
    otp = "",
  } = await req.json().catch(() => ({}));
  const em = String(email).toLowerCase().trim();
  await ensureBootstrapAdmin();
  const users = await getUsers();
  const u = users.find((x) => x.email === em);
  if (!u) return NextResponse.json({ error: "Invalid login" }, { status: 401 });
  if (u.lockedUntil && u.lockedUntil > Date.now())
    return NextResponse.json({ error: "Locked. Try later." }, { status: 423 });
  const ok = safeEqual(hashPass(String(password), u.salt), u.passHash);
  if (!ok) {
    u.failCount = (u.failCount || 0) + 1;
    if (u.failCount >= MAX_FAIL) {
      u.lockedUntil = Date.now() + WINDOW_MS;
      u.failCount = 0;
    }
    await saveUsers(users);
    await audit({
      at: Date.now(),
      adminId: u.id,
      email: u.email,
      action: "login.fail",
      ip,
    });
    return NextResponse.json({ error: "Invalid login" }, { status: 401 });
  }
  if (u.totpSecret && String(otp).trim().length < 6)
    return NextResponse.json(
      { error: "OTP required", otpRequired: true },
      { status: 401 },
    );
  u.failCount = 0;
  u.lockedUntil = 0;
  await saveUsers(users);
  const token = newToken();
  const sessions = await getSessions();
  sessions.push({
    token,
    adminId: u.id,
    role: u.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + 12 * 3600 * 1000,
    ip,
  });
  await saveSessions(sessions);
  await audit({
    at: Date.now(),
    adminId: u.id,
    email: u.email,
    action: "login.ok",
    ip,
  });
  const res = NextResponse.json({ ok: true, role: u.role });
  res.cookies.set("admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 3600,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_token", "", { path: "/", maxAge: 0 });
  return res;
}
