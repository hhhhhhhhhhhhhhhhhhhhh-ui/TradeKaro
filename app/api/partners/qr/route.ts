import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { landingPage } from "@/app/lib/affiliates";
import { publicBaseUrl } from "@/app/lib/requestProto";
import { needPartner } from "../../partners/_guard";

// GET /api/partners/qr?slug=start&c=instagram-reel-aug
//
// Returns an SVG QR code for THIS partner's link. The URL is built server-side
// from the signed-in partner's own code — the caller cannot ask for an arbitrary
// string to be encoded, so this cannot be used as a free QR generator or to
// launder a link through our domain.
//
// SVG rather than PNG: it stays crisp when a partner scales it for a flyer,
// and it needs no native image library.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const sp = req.nextUrl.searchParams;
  const wanted = String(sp.get("slug") || "start").toLowerCase();
  const slug = landingPage(wanted) ? wanted : "start";
  const campaign = String(sp.get("c") || "").slice(0, 80);

  // The SHORT link, not the long one. A QR is scanned by a phone, and the fewer
  // characters in it the larger the modules print at the same physical size —
  // which is the difference between a flyer that scans and one that does not.
  const bare = g.affiliate.code.replace(/^PT-/, "");
  const url = new URL(`/r/${bare}/${slug}`, publicBaseUrl(req));
  if (campaign) url.searchParams.set("c", campaign);

  try {
    const svg = await QRCode.toString(url.toString(), {
      type: "svg",
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // Private because it is one partner's link; short-lived because the
        // origin can change between a local run and a deployment.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not build a QR code" },
      { status: 500 },
    );
  }
}
