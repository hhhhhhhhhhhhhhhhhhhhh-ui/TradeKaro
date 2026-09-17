import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifyToken } from "@/app/lib/authStore";

// POST /api/v1/auth/verifyToken — used by middleware + security page.
export async function POST(req: NextRequest) {
  const claims = await verifyToken(await tokenFromRequest(req));
  if (!claims)
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  return NextResponse.json({ ok: true, username: claims.username });
}
