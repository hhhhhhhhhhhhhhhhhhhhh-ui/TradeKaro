import { NextRequest, NextResponse } from "next/server";
import { verifyToken, tokenFromRequest } from "@/app/lib/authStore";

// POST /api/v1/transaction/buyScrip — the local ledger performs the
// real fill client-side; this endpoint validates the session so logged-in
// flows get a clean 200 (guests fall back to purely local fills).
export async function POST(req: NextRequest) {
  const claims = await verifyToken(await tokenFromRequest(req));
  if (!claims)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
