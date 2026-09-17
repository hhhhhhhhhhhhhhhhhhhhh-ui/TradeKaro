import { NextRequest, NextResponse } from "next/server";
import { verifyToken, tokenFromRequest } from "@/app/lib/authStore";

// POST /api/v1/transaction/sellScrip — mirror of buyScrip.
export async function POST(req: NextRequest) {
  const claims = await verifyToken(await tokenFromRequest(req));
  if (!claims)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
