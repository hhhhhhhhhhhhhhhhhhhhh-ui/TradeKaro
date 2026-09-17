import { NextRequest, NextResponse } from "next/server";
import {
  audit,
  getSessions,
  getUsers,
  saveSessions,
} from "@/app/lib/adminStore";
import { adminFrom, deny, needAdmin } from "../_guard";

// GET — every live admin session (viewer+). Tokens are never returned in
// full: each row carries a short id the client can use to revoke it, and a
// `current` flag so the UI can label the caller's own session.
export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const [sessions, users] = await Promise.all([getSessions(), getUsers()]);
  const now = Date.now();
  const rows = sessions
    .map((s) => {
      const u = users.find((x) => x.id === s.adminId);
      return {
        id: s.token.slice(0, 12),
        adminId: s.adminId,
        email: u?.email || "(removed admin)",
        role: s.role,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        ip: s.ip || "local",
        current: s.token === a.session.token,
        ttlMin: Math.max(0, Math.round((s.expiresAt - now) / 60000)),
      };
    })
    .sort(
      (x, y) =>
        Number(y.current) - Number(x.current) || y.createdAt - x.createdAt,
    );
  return NextResponse.json({
    sessions: rows,
    total: rows.length,
    canRevoke: needAdmin(a.user.role, "operator"),
  });
}

// DELETE ?id=<id>      — revoke one session
// DELETE ?all=1        — revoke every session except the caller's own
export async function DELETE(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const all = url.searchParams.get("all") === "1";
  const ip = req.headers.get("x-forwarded-for") || "local";
  const sessions = await getSessions();

  if (all) {
    const keep = sessions.filter((s) => s.token === a.session.token);
    const revoked = sessions.length - keep.length;
    await saveSessions(keep);
    await audit({
      at: Date.now(),
      adminId: a.user.id,
      email: a.user.email,
      action: "session.revoke_all",
      detail: `${revoked} session(s) revoked, own kept`,
      ip,
    });
    return NextResponse.json({ ok: true, revoked });
  }

  if (!id)
    return NextResponse.json(
      { error: "id or all=1 required" },
      { status: 400 },
    );

  const target = sessions.find((s) => s.token.slice(0, 12) === id);
  if (!target)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const users = await getUsers();
  const owner = users.find((x) => x.id === target.adminId);
  const self = target.token === a.session.token;

  await saveSessions(sessions.filter((s) => s.token !== target.token));
  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "session.revoke",
    detail: `${id} · ${owner?.email || target.adminId}${self ? " (self)" : ""}`,
    ip,
  });

  // `self: true` means the caller just signed themselves out — the client
  // should drop to the login screen.
  return NextResponse.json({ ok: true, revoked: 1, self });
}
