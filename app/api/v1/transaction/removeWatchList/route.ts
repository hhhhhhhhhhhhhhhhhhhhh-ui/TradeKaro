import { NextRequest, NextResponse } from "next/server";
import { currentUser, updateUser } from "@/app/lib/authStore";

// POST /api/v1/transaction/removeWatchList
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { scrip = "" } = await req.json().catch(() => ({}));
  const sym = String(scrip).trim().toUpperCase();
  await updateUser(user.id, {
    watchlist: user.watchlist.filter((s) => s !== sym),
  });
  return NextResponse.json({ ok: true });
}
