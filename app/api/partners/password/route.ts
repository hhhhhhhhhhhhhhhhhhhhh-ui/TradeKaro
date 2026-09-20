import { NextRequest, NextResponse } from "next/server";
import { changePartnerPassword, touchLogin } from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// POST /api/partners/password — change the affiliate password.
//
// Both the current and the new password arrive as sha256 hex, exactly as the
// sign-in form sends them, and are scrypt-hashed again here before storage.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => ({}));
  const res = changePartnerPassword(
    g.affiliate.id,
    String(body?.current || ""),
    String(body?.next || ""),
  );
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  void touchLogin;
  return NextResponse.json({ ok: true, message: "Password updated." });
}
