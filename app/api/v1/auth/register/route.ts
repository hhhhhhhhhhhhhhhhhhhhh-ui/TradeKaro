import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/app/lib/authStore";
import { attributeSignup } from "@/app/lib/affiliates";
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
    ref = "",
    campaign = "",
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

  // ── Affiliate attribution ────────────────────────────────────────────────
  //
  // A partner link lands on /l/<slug>?ref=PT-XXXXXX, which records the click and
  // drops the `ref` cookie. That cookie is read here to bind the new account to
  // the partner permanently.
  //
  // The cookie is preferred over the body, and the body is only a fallback for a
  // signup form that passed `ref` through its own URL. Both are the same kind of
  // untrusted input: `attributeSignup` refuses unknown codes, unapproved
  // affiliates, self-referrals and any attempt to re-own an existing customer,
  // so a hand-typed `ref` cannot steal someone else's account.
  //
  // Never allowed to fail the signup — the account exists either way.
  try {
    const cookieRef = /(?:^|;\s*)ref=([^;]+)/.exec(
      req.headers.get("cookie") || "",
    );
    const code = String(
      (cookieRef ? decodeURIComponent(cookieRef[1]) : "") || ref || "",
    ).trim();
    if (code) {
      const cookieCampaign = /(?:^|;\s*)ref_c=([^;]+)/.exec(
        req.headers.get("cookie") || "",
      );
      const attribution = attributeSignup({
        userId: out.id,
        code,
        landing: "signup",
        campaign: String(
          (cookieCampaign ? decodeURIComponent(cookieCampaign[1]) : "") ||
            campaign ||
            "",
        ).slice(0, 80),
      });
      // A refusal here is the one thing in this flow worth shouting about. The
      // customer's account exists and the visit was counted, so nothing looks
      // broken — but the partner is credited with nobody, and until now that was
      // completely indistinguishable from a signup that carried no referral at
      // all. Logged, never surfaced to the visitor, and never allowed to fail
      // the signup.
      if (!attribution.ok && attribution.reason !== "no_user") {
        console.warn(
          `[affiliate] signup attribution refused: reason=${attribution.reason} code=${code} user=${out.id}`,
        );
      }
    }
  } catch {
    /* attribution must never block an account from being created */
  }

  return NextResponse.json({
    ok: true,
    message: "User registered successfully!",
  });
}
