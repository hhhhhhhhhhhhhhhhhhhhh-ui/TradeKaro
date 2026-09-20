import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/app/lib/affiliates";
import { isSecureRequest } from "@/app/lib/requestProto";

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
  });

  const res = NextResponse.json({
    ok: true,
    tracked: result.recorded,
    unique: result.unique,
    ...(result.reason ? { reason: result.reason } : {}),
  });

  if (!result.recorded) return res;

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
