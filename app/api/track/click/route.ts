import { NextRequest, NextResponse, after } from "next/server";
import { recordClick } from "@/app/lib/affiliates";
import { isSecureRequest } from "@/app/lib/requestProto";
import { pickSignals } from "@/app/lib/tracking";
import {
  consentRequiredForCountry,
  countryFromHeaders,
} from "@/app/lib/consent";
import {
  configuredProviders,
  dispatchPendingConversions,
} from "@/app/lib/conversionsDispatch";

// POST /api/track/click
//
// Called once by a landing page when it renders. Two jobs, and both matter:
//
//   1. Write a click row server-side. A cookie alone is clearable and forgeable,
//      so the durable record of "this affiliate sent this visit" lives here.
//
//   2. Drop the `ref` cookie, which is what the signup route reads to bind the
//      new account to the affiliate.
//
// A PREVIEW is not a visit. When `preview` is set the click is neither recorded
// nor cookied: the visitor is the partner checking their own link. Setting the
// cookie on a preview would also leave a partner carrying their own referral
// around in the browser afterwards.
//
// Unknown codes are ignored rather than logged, so a random string in a URL
// cannot fill the table.

export const dynamic = "force-dynamic";

const REF_COOKIE = "ref";
const REF_DAYS = 90;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "")
    .toUpperCase()
    .slice(0, 32);
  const slug = String(body?.slug || "").slice(0, 80);
  const campaign = String(body?.campaign || "").slice(0, 80);
  const preview = body?.preview === true || body?.preview === "1";

  // Ad click ids and utm params, snapshotted when the visitor lands. Re-picked
  // through the allowlist here rather than trusted from the body: this endpoint
  // is unauthenticated, so the client is not a source of truth about what may be
  // written.
  const signals = pickSignals((body?.signals || {}) as Record<string, unknown>);

  // Opportunistic drain of the conversion queue.
  //
  // Somewhere to hang this that costs nothing and needs no infrastructure: every
  // landing visit is a chance to send what is owed, so the queue still drains on
  // a host where nobody ever set up a cron. A cron or systemd timer calling
  // /api/track/dispatch is the reliable path; this is the safety net.
  //
  // `after()` runs once the response is already on its way, so no visitor ever
  // waits for Meta. Bounded to a handful so a large backlog cannot turn one page
  // view into a long-running job.
  if (configuredProviders().length) {
    after(async () => {
      try {
        await dispatchPendingConversions({ limit: 5 });
      } catch {
        /* a marketing send must never surface to a visitor */
      }
    });
  }

  // Opportunistic drain of the conversion queue.
  //
  // Somewhere to hang this that costs nothing and needs no infrastructure: every
  // landing visit is a chance to send what is owed, so the queue drains on a host
  // where nobody ever set up a cron. A cron or systemd timer calling
  // /api/track/dispatch is still the reliable path; this is the safety net.
  //
  // `after()` runs it once the response is already on its way, so no visitor
  // ever waits for Meta. Bounded to a handful so a large backlog does not turn
  // one page view into a long-running job.
  if (configuredProviders().length) {
    after(async () => {
      try {
        await dispatchPendingConversions({ limit: 5 });
      } catch {
        /* a marketing send must never surface to a visitor */
      }
    });
  }

  // Whether this visitor was owed a banner is decided HERE, from the edge's
  // geolocation header, and never from the request body. This endpoint is
  // unauthenticated: a caller may tell us what they chose, but not what the law
  // in their country says.
  const requiresConsent = consentRequiredForCountry(
    countryFromHeaders(req.headers),
  );

  if (!code)
    return NextResponse.json({ ok: true, tracked: false, reason: "no_code" });

  const result = recordClick({
    code,
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "",
    ua: req.headers.get("user-agent") || "",
    landing: slug,
    campaign,
    referer: req.headers.get("referer") || "",
    preview,
    signals,
    // No banner owed means tracking is permitted without one, and saying so at
    // click time is what stops Phase 4 treating "no answer" as a refusal for
    // every Indian visitor.
    consent: requiresConsent ? null : "exempt",
  });

  const res = NextResponse.json({
    ok: true,
    tracked: result.recorded,
    unique: result.unique,
    consentRequired: requiresConsent,
    // How many of the allowlisted params were kept. Diagnostic only: a partner
    // debugging a broken fbclid needs to see whether it arrived, without the
    // panel having to expose the token itself.
    signals: Object.keys(signals).length,
    ...(result.reason ? { reason: result.reason } : {}),
  });

  if (!result.recorded) return res;

  // The row id, so the banner can attach the visitor's answer to THIS click
  // once they make it. Short-lived: it only has to outlive the banner.
  if (result.id)
    res.cookies.set("tc_cid", String(result.id), {
      path: "/",
      maxAge: 86400,
      sameSite: "lax",
      secure: isSecureRequest(req),
    });

  res.cookies.set(REF_COOKIE, code, {
    path: "/",
    maxAge: REF_DAYS * 86400,
    sameSite: "lax",
    secure: isSecureRequest(req),
  });
  if (campaign)
    res.cookies.set("ref_c", campaign, {
      path: "/",
      maxAge: REF_DAYS * 86400,
      sameSite: "lax",
      secure: isSecureRequest(req),
    });

  // This MUST return `res` and not a freshly built response. `res.cookies.set`
  // attaches the Set-Cookie headers to `res` itself, so constructing a second
  // response here silently discarded them — the click was recorded but no
  // referral cookie ever reached the browser, which left the signup route with
  // nothing to attribute the new account to. It also dropped `unique` from the
  // body, so the flag was present on exactly the responses that did not have a
  // click to describe.
  return res;
}
