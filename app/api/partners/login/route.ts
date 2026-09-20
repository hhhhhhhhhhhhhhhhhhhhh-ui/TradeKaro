import { NextRequest, NextResponse } from "next/server";
import { PARTNER_COOKIE, issuePartnerToken } from "@/app/lib/affiliateAuth";
import {
  affiliateByEmail,
  touchLogin,
  verifyPartnerLogin,
} from "@/app/lib/affiliates";
import {
  clientIp,
  loginLockStatus,
  recordLoginFail,
  recordLoginSuccess,
} from "@/app/lib/loginGuard";
import { isSecureRequest } from "@/app/lib/requestProto";

// POST /api/partners/login — affiliate sign-in.
//
// Sets `partner_token`, never `token`. A partner session is therefore invisible
// to every trader route and to `proxy.ts`'s trader guard.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { email = "", password = "" } = await req.json().catch(() => ({}));
  const addr = String(email).trim();
  const ip = clientIp(req);

  const lock = loginLockStatus(ip, `partner:${addr}`);
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

  const existing = affiliateByEmail(addr);
  const check = verifyPartnerLogin(addr, String(password));

  // One generic message for "no such affiliate" and "wrong password", so this
  // endpoint cannot be used to enumerate who is a partner.
  if (!check) {
    recordLoginFail(ip, `partner:${addr}`);
    return NextResponse.json(
      { error: "Incorrect email or password" },
      { status: 401 },
    );
  }
  recordLoginSuccess(ip, `partner:${addr}`);

  // Correct password but not approved yet: the applicant gets a useful answer
  // instead of a dead end. No token is issued for pending/rejected/suspended.
  if (check.status !== "approved") {
    const messages: Record<string, string> = {
      pending:
        "Your application is still under review. You will be able to sign in once it is approved.",
      rejected: check.rejectReason
        ? `Your application was not approved: ${check.rejectReason}`
        : "Your application was not approved.",
      suspended:
        "Your partner account is suspended. Please contact your account manager.",
    };
    return NextResponse.json(
      {
        error: messages[check.status] || "Account not active",
        status: check.status,
      },
      { status: 403 },
    );
  }

  void existing;
  touchLogin(check.id);
  const token = await issuePartnerToken({
    id: check.id,
    code: check.code,
    email: check.email,
  });

  const res = NextResponse.json({
    token,
    partner: {
      id: check.id,
      code: check.code,
      name: check.name,
      email: check.email,
      status: check.status,
    },
  });
  res.cookies.set(PARTNER_COOKIE, token, {
    path: "/",
    maxAge: 30 * 86400,
    sameSite: "lax" as const,
    secure: isSecureRequest(req),
    // Not HttpOnly on purpose, matching the trader session: the panel is a
    // client shell that sends the token as a Bearer header. The token is still
    // unreadable to any other origin, and the API re-verifies it every call.
  });
  return res;
}
