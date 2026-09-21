import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/app/lib/authStore";
import { attributeSignup } from "@/app/lib/affiliates";
import {
  consentFromCookieHeader,
  gaClientIdFromCookie,
  recordConversionEvent,
} from "@/app/lib/conversions";
import { signupEventId } from "@/app/lib/trackingEvents";
import {
  consentRequiredForCountry,
  countryFromHeaders,
} from "@/app/lib/consent";
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

  // ── Conversion event ─────────────────────────────────────────────────────
  //
  // Recorded server-side, in the same request that created the account, so the
  // event exists even if the visitor closes the tab on the welcome screen and
  // the browser pixel never fires.
  //
  // The id is derived from the user id, not generated here — that is what lets
  // the browser report the same conversion under the same id and have Meta and
  // Google collapse the pair into one, instead of counting two signups for one
  // customer.
  //
  // Runs BEFORE attribution is looked up in the row anyway, but after
  // `attributeSignup` so the click is already stamped with this user and the
  // event can carry the affiliate code and the consent recorded at landing.
  //
  // Consent is resolved the same way the click endpoint resolves it, and that
  // matters more than it looks: a visitor from a jurisdiction that owes no
  // banner never sees one, so they never get a `tc_consent` cookie AND may have
  // no click row either. Left at that, every organic Indian signup would be
  // recorded as `unknown` and Phase 4 would decline to report any of them —
  // silently discarding the conversions this whole exercise exists to measure.
  // Asking the same geolocation question here is what makes "no banner owed"
  // mean "permitted" rather than "unanswered".
  let eventId: string | null = null;
  try {
    const allowsWithoutBanner = !consentRequiredForCountry(
      countryFromHeaders(req.headers),
    );
    const rec = recordConversionEvent({
      name: "CompleteRegistration",
      eventId: signupEventId(out.id),
      userId: out.id,
      explicitConsent:
        consentFromCookieHeader(req.headers.get("cookie")) ||
        (allowsWithoutBanner ? "exempt" : ""),
      // Captured here because this is the last moment the browser is present.
      // The deposit that eventually follows arrives on a webhook, and GA4 will
      // not attribute an event without a client id.
      gaClientId: gaClientIdFromCookie(req.headers.get("cookie")),
      // This request's own ip and user agent — Meta matches far better with
      // them, and an organic signup has no affiliate click to borrow them from.
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "",
      ua: req.headers.get("user-agent") || "",
    });
    eventId = rec.eventId;
  } catch {
    /* a marketing table must never cost someone their account */
  }

  return NextResponse.json({
    ok: true,
    message: "User registered successfully!",
    // Echoed so the signup screen can fire the browser pixel with the same id.
    ...(eventId ? { eventId } : {}),
  });
}
