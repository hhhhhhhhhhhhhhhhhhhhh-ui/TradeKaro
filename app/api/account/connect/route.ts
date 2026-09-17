import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/app/lib/authStore";
import { findDirectoryUser, standingForUser } from "@/app/lib/directory";
import { connectTokenFor } from "@/app/lib/connectToken";
import { accountKey, kycRequirement } from "@/app/lib/tradingServer";
import { depositedTotal } from "@/app/lib/deposits";
import { kycGate } from "@/app/lib/kycGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connect-account surface.
//
//   GET  → who you are + whether the connection token is available
//   POST → hand over the token, or refuse with the reason
//
// The token is only ever minted and returned here, behind a server-side check.
// If the browser decided whether KYC was done, the gate would be decoration —
// same reasoning as the deposit gate in tradingServer.publicAccount().

async function context(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return null;
  // The directory is the one place that resolves a registered account against
  // its heartbeat row, so the client ID matches what the profile page shows.
  const dir = await findDirectoryUser(user.id).catch(() => null);
  const { kyc, status } = await standingForUser(user.id);
  const key = accountKey(user.id);
  const gate = kycGate(depositedTotal(key), await kycRequirement());
  return {
    userId: String(user.id),
    clientID: dir?.clientID || String(user.id),
    clientCode: user.clientCode || dir?.clientCode || "",
    username: user.username,
    email: user.email,
    kyc,
    status,
    /** KYC is signed off by an operator; the deposit gate is the prerequisite. */
    unlocked: kyc === "VERIFIED" && status !== "FROZEN",
    gate,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(ctx);
}

export async function POST(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (ctx.status === "FROZEN")
    return NextResponse.json(
      {
        error:
          "This account is frozen — contact support before connecting a platform",
        code: "frozen",
      },
      { status: 403 },
    );

  if (ctx.kyc !== "VERIFIED")
    return NextResponse.json(
      {
        error: "Complete KYC to access your token",
        code: "kyc_required",
        kyc: ctx.kyc,
        gate: ctx.gate,
      },
      { status: 403 },
    );

  return NextResponse.json({
    ok: true,
    token: connectTokenFor(ctx.userId),
    issuedAt: Date.now(),
  });
}
