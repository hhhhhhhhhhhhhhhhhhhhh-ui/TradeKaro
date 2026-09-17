import { NextRequest, NextResponse } from "next/server";
import { currentUser, updateUser } from "@/app/lib/authStore";

// POST /api/v1/transaction/addWatchlist — 409 when already present.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { scrip = "" } = await req.json().catch(() => ({}));
  const sym = String(scrip).trim().toUpperCase();
  if (!sym)
    return NextResponse.json({ error: "Missing scrip" }, { status: 400 });
  if (user.watchlist.includes(sym))
    return NextResponse.json(
      { error: "Already in watchlist" },
      { status: 409 },
    );
  await updateUser(user.id, { watchlist: [...user.watchlist, sym] });
  return NextResponse.json({ ok: true });
}
