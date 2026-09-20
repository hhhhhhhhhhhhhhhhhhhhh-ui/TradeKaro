import { NextRequest, NextResponse } from "next/server";
import { PARTNER_COOKIE } from "@/app/lib/affiliateAuth";

// POST /api/partners/logout — clears the partner cookie only.
// The trader session (cookie `token`) is untouched: signing out of the partner
// panel must not sign the same browser out of the trading app.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PARTNER_COOKIE, "", { path: "/", maxAge: 0 });
  void req;
  return res;
}
