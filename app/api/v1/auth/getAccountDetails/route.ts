import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/app/lib/authStore";
import { accountSnapshot } from "@/app/lib/accountData";
import { standingForUser } from "@/app/lib/directory";

// POST /api/v1/auth/getAccountDetails — the account summary consumed by
// portfolio, orders, ledger, profile, heartbeat, navbar + dashboard strip.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [snap, standing] = await Promise.all([
    accountSnapshot(user.id, user.email),
    standingForUser(user.id),
  ]);
  return NextResponse.json({
    username: user.username,
    email: user.email,
    // `id` stays the internal key; `clientCode` is the one we show a customer.
    clientID: user.id,
    clientCode: user.clientCode,
    createdAt: user.createdAt,
    pan: "",
    // Was hardcoded "PENDING", which made the profile badge disagree with the
    // operator's actual verdict in Users & KYC (and with the KYC page).
    kyc: standing.kyc,
    status: standing.status,
    remainingCash: snap.remainingCash,
    spentCash: snap.spentCash,
    scrips: snap.scrips,
    // Trades are rendered client-side from the local book —
    // keeping this empty avoids showing every fill twice.
    orderBook: [],
  });
}
