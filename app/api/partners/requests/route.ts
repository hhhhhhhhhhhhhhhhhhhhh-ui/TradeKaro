import { NextRequest, NextResponse } from "next/server";
import { createRequest, requestsFor } from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET  /api/partners/requests — what this partner has asked us for
// POST /api/partners/requests — ask for a landing page or a creative
//
// This replaced a `mailto:` link, which left the panel, depended on the partner
// having a mail client configured, and left no record anywhere. A request that
// goes nowhere is worse than no button at all.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  return NextResponse.json({ requests: requestsFor(g.affiliate.id) });
}

export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => ({}));
  const res = createRequest({
    affiliateId: g.affiliate.id,
    kind: body?.kind,
    title: body?.title,
    detail: body?.detail,
    audience: body?.audience,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    ok: true,
    id: res.id,
    message:
      "Request sent. Our partnerships team reviews these and will reply from your account manager.",
    requests: res.requests,
  });
}
