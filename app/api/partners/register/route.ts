import { NextRequest, NextResponse } from "next/server";
import { registerAffiliate } from "@/app/lib/affiliates";

// POST /api/partners/register — public affiliate application.
//
// Creates a `pending` affiliate. It deliberately does NOT sign anyone in: an
// unapproved partner has nothing to see, so this route never sets a cookie and
// the response just tells the applicant to wait for review.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const res = registerAffiliate({
    name: body?.name,
    email: body?.email,
    phone: body?.phone,
    company: body?.company,
    website: body?.website,
    audience: body?.audience,
    password: body?.password,
  });

  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    ok: true,
    status: "pending",
    code: res.affiliate.code,
    message:
      "Application received. Our partnerships team reviews new partners within one working day.",
  });
}

/** Kept so an over-eager client cannot sign itself in through this route. */
export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
