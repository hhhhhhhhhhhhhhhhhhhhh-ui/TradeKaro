import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/app/lib/authStore";
import { isPhone, normalisePhone } from "@/app/lib/phone";

const CONFLICT: Record<string, string> = {
  username: "That username is already taken",
  email: "That email is already registered",
  phone: "That mobile number is already registered",
};

// POST /api/v1/register — replaces the external worker's register.
export async function POST(req: NextRequest) {
  const {
    username = "",
    email = "",
    password = "",
    phone = "",
  } = await req.json().catch(() => ({}));
  const uname = String(username).trim();
  const mail = String(email).trim();
  const hash = String(password);
  const ph = normalisePhone(phone);
  if (!uname || !mail || !hash)
    return NextResponse.json(
      { error: "username, email and password are required" },
      { status: 400 },
    );
  // Format check only. With no SMS step yet this is a convenience identifier,
  // not proof the number belongs to whoever typed it.
  if (!isPhone(ph))
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 },
    );
  const out = await createUser(uname, mail, hash, ph);
  if ("error" in out)
    return NextResponse.json(
      {
        error: CONFLICT[out.field] || "Already registered",
        field: out.field,
      },
      { status: 409 },
    );
  return NextResponse.json({
    ok: true,
    message: "User registered successfully!",
  });
}
