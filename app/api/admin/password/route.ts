import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  getSessions,
  getUsers,
  hashPass,
  newSalt,
  safeEqual,
  saveSessions,
  saveUsers,
} from "@/app/lib/adminStore";
import { adminFrom, deny } from "../_guard";

// POST /api/admin/password — rotate the caller's own console credential.
//
// The admin login endpoint sends the plaintext password and lets the server
// salt + sha256 it (see app/api/admin/login/route.ts), so this endpoint takes
// the same shape rather than inventing a second hashing convention.
export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();

  const body = await req.json().catch(() => ({}));
  const current = String(body?.current ?? body?.currentPassword ?? "");
  const next = String(body?.next ?? body?.newPassword ?? "");
  const ip = req.headers.get("x-forwarded-for") || "local";

  if (!current || !next)
    return NextResponse.json(
      { error: "Current and new password are required" },
      { status: 400 },
    );
  if (next.length < 8)
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 },
    );

  // Always compare against the stored hash + that user's salt. The bootstrap
  // ADMIN_PASSWORD env var is only ever read on first boot, so it must never
  // be consulted here — doing so would make an env edit look like a working
  // password rotation.
  if (!safeEqual(hashPass(current, a.user.salt), a.user.passHash)) {
    await audit({
      at: Date.now(),
      adminId: a.user.id,
      email: a.user.email,
      action: "admin.password_fail",
      ip,
    });
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  // Re-hashing the same value changes the salt but not the secret, which
  // would report success while nothing actually rotated.
  if (next === current)
    return NextResponse.json(
      { error: "New password matches the current one" },
      { status: 400 },
    );

  const users = await getUsers();
  const me = users.find((u) => u.id === a.user.id);
  if (!me) return deny();

  const salt = newSalt();
  me.salt = salt;
  me.passHash = hashPass(next, salt);
  // A successful rotation clears any lockout the account was carrying.
  me.failCount = 0;
  me.lockedUntil = 0;
  await saveUsers(users);

  // Sessions belonging to this admin are now stale. Keep the caller's own
  // token so the tab they are sitting in keeps working; drop the rest.
  const sessions = await getSessions();
  const keep = sessions.filter(
    (s) => s.adminId !== a.user.id || s.token === a.session.token,
  );
  const revoked = sessions.length - keep.length;
  if (revoked > 0) await saveSessions(keep);

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "admin.password",
    detail: revoked
      ? `${revoked} other session(s) revoked`
      : "no other sessions",
    ip,
  });

  return NextResponse.json({ ok: true, revoked });
}
