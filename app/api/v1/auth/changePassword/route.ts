import { NextRequest, NextResponse } from "next/server";
import {
  currentUser,
  hashPassword,
  updateUser,
  verifyLogin,
} from "@/app/lib/authStore";

// POST /api/v1/auth/changePassword — payload arrives sha256-hashed
// client-side (oldPassword/newPassword + aliases); we verify + re-salt.
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const oldHash = String(body?.oldPassword || body?.currentPassword || "");
  const newHash = String(body?.newPassword || body?.password || "");
  if (!oldHash || !newHash)
    return NextResponse.json({ error: "Missing passwords" }, { status: 400 });

  const authed = await verifyLogin(user.username, oldHash);
  if (!authed)
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  if (newHash === oldHash)
    return NextResponse.json(
      { error: "New password matches old" },
      { status: 400 },
    );

  const { randomBytes } = await import("crypto");
  const salt = randomBytes(16).toString("hex");
  await updateUser(user.id, { salt, passHash: hashPassword(newHash, salt) });
  return NextResponse.json({ ok: true });
}
