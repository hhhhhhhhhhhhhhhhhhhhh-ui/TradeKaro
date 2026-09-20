import { NextRequest, NextResponse } from "next/server";
import { affiliateByCode, landingPage } from "@/app/lib/affiliates";

// GET /r/<code>            → the default landing page
// GET /r/<code>/<slug>     → a specific landing page
// GET /r/<code>?c=tag      → carried into the campaign tag
//
// The shareable short form of an affiliate link. What partners were copying
// before was:
//
//   /l/start?ref=PT-DEMO01&c=instagram-reel-aug
//
// which is unusable in an Instagram bio or a printed flyer. This is
// `/r/demo01`, and it takes the same campaign tag.
//
// The folder is an OPTIONAL catch-all. A single `[slug]` segment would not match
// `/r/DEMO01` at all, and a plain `[...slug]` would not match it either, so
// neither could serve both URLs this route promises. Only the first segment is
// ever read; catching the rest means a slightly malformed flyer URL still lands
// the visitor on the product instead of a 404.
//
// A SHORT LINK DOES NOT RECORD THE CLICK ITSELF. It redirects to the landing
// page, which already does that — one recorder, one place to be correct. Without
// that rule every click would be counted twice the moment somebody followed the
// redirect.
//
// The code is accepted with or without the `PT-` prefix so the URL stays short,
// and the redirect target is rebuilt from the database rather than from the
// query string. Nothing the visitor supplies is echoed into a URL, so this
// cannot be turned into an open redirect.

export const dynamic = "force-dynamic";

/** `DEMO01` and `PT-DEMO01` are the same affiliate. */
function normaliseCode(raw: string) {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  return s.startsWith("PT-") ? s : `PT-${s}`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string; slug?: string[] }> },
) {
  const { code: rawCode, slug: slugParts } = await ctx.params;
  const code = normaliseCode(rawCode);

  const wanted = String(slugParts?.[0] || "").toLowerCase();
  // An unknown slug falls back to the default page rather than 404-ing: a
  // visitor arriving through a stale short link should land on the product, not
  // on an error page.
  const slug = wanted && landingPage(wanted) ? wanted : "start";

  const params = new URLSearchParams();
  const affiliate = code ? affiliateByCode(code) : null;
  // Only attribute to an affiliate who can actually be attributed. A suspended
  // partner's old links keep working for the visitor and simply stop crediting
  // them, which is what suspension has to mean.
  if (affiliate && affiliate.status === "approved")
    params.set("ref", affiliate.code);

  const campaign = String(req.nextUrl.searchParams.get("c") || "").slice(0, 80);
  if (campaign) params.set("c", campaign);
  if (req.nextUrl.searchParams.get("preview") === "1")
    params.set("preview", "1");

  const qs = params.toString();
  const dest = new URL(`/l/${slug}${qs ? `?${qs}` : ""}`, req.nextUrl.origin);

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: dest.toString(),
      // A short link is a pointer, and a cached pointer sends later visitors to
      // a stale destination. Never store it.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
