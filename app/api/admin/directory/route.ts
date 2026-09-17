import { NextRequest, NextResponse } from "next/server";
import { adminFrom, deny } from "../_guard";
import { getDirectory } from "@/app/lib/directory";

// Unified client directory: every registered account, enriched with heartbeat
// activity. Previously this read the heartbeat registry alone, so anyone who
// signed up but never logged in was invisible to the admin panel.
//
// ?q=            search username / email / phone / clientID
// ?includeTest=1 also show dev + smoke accounts (hidden by default)
export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").toLowerCase().trim();
  const includeTest = url.searchParams.get("includeTest") === "1";

  const every = await getDirectory();
  const testCount = every.filter((u) => u.isTest).length;
  const shown = includeTest ? every : every.filter((u) => !u.isTest);
  const filtered = q
    ? shown.filter((u) =>
        [u.username, u.email, u.phone, u.clientID, u.id]
          .map((v) => String(v || "").toLowerCase())
          .some((v) => v.includes(q)),
      )
    : shown;

  if (!every.length) {
    const { getUsers } = await import("@/app/lib/adminStore");
    const ops = await getUsers();
    return NextResponse.json({
      users: [],
      operators: ops.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        locked: Boolean(u.lockedUntil && u.lockedUntil > Date.now()),
        createdAt: u.createdAt,
      })),
      source: "directory",
      note: "No accounts yet — they appear here as soon as someone registers.",
    });
  }

  return NextResponse.json({
    users: filtered.slice(0, 500),
    total: filtered.length,
    registered: every.filter((u) => u.registered).length,
    neverLoggedIn: every.filter((u) => u.neverLoggedIn).length,
    hiddenTest: includeTest ? 0 : testCount,
    source: "directory",
  });
}
