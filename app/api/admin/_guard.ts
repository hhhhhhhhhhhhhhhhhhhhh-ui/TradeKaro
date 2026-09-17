import { NextRequest, NextResponse } from "next/server";
import { getSessions, getUsers } from "@/app/lib/adminStore";

export async function adminFrom(req: NextRequest) {
  const token = req.cookies.get("admin_token")?.value || "";
  if (!token) return null;
  const sessions = await getSessions();
  const s = sessions.find((x) => x.token === token);
  if (!s) return null;
  const users = await getUsers();
  const u = users.find((x) => x.id === s.adminId);
  if (!u) return null;
  return { user: u, session: s };
}

export function needAdmin(
  role: string,
  min: "viewer" | "operator" | "superadmin",
) {
  const rank: Record<string, number> = {
    viewer: 1,
    operator: 2,
    superadmin: 3,
  };
  return (rank[role] || 0) >= rank[min];
}

export function deny() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
