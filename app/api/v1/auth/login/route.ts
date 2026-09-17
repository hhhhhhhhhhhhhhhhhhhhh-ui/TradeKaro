import { NextRequest, NextResponse } from "next/server";
import { issueToken, verifyLogin } from "@/app/lib/authStore";
import {
  clientIp,
  loginLockStatus,
  recordLoginFail,
  recordLoginSuccess,
} from "@/app/lib/loginGuard";

// POST /api/v1/login — replaces the external worker's login.
// Sets non-HttpOnly cookies (the client reads them via cookies-next).
export async function POST(req: NextRequest) {
  const {
    username = "",
    password = "",
    remember = true,
  } = await req.json().catch(() => ({}));
  const uname = String(username).trim();
  const ip = clientIp(req);

  const lock = loginLockStatus(ip, uname);
  if (lock.locked)
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${Math.max(
          1,
          Math.ceil(lock.retryAfterSec / 60),
        )} minute(s).`,
      },
      { status: 429 },
    );

  const user = await verifyLogin(uname, String(password));
  if (!user) {
    recordLoginFail(ip, uname);
    return NextResponse.json(
      { error: "Incorrect credentials" },
      { status: 401 },
    );
  }
  recordLoginSuccess(ip, uname);

  const token = await issueToken(user);
  const res = NextResponse.json({
    token,
    username: user.username,
    email: user.email,
    clientID: user.id,
  });
  const week = 7 * 86400;
  // "Remember me" only controls whether the cookie survives a browser restart —
  // the JWT's own 7-day expiry is unchanged either way.
  const base = remember === false ? { path: "/" } : { path: "/", maxAge: week };
  res.cookies.set("token", token, { ...base, sameSite: "lax" as const });
  res.cookies.set("username", user.username, base);
  res.cookies.set("email", user.email, base);
  res.cookies.set("clientID", user.id, base);
  return res;
}
