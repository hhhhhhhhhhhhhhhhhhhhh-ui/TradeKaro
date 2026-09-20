import { NextRequest, NextResponse } from "next/server";
import {
  affiliateByEmail,
  affiliateById,
  dashboard,
  plans,
  publicProfile,
} from "@/app/lib/affiliates";
import { needPartner } from "../_guard";

// GET /api/partners/me
//
// The whole dashboard in one round trip — profile, KPIs, 30-day series and the
// latest activity. One request instead of five is the difference between a
// panel that feels instant on mobile data and one that does not.
//
// `?email=` is an unauthenticated status probe used by the sign-in screen to
// explain "under review" without a password. It answers with a status only and
// never echoes anything else about the account.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (email) {
    const row = affiliateByEmail(email);
    return NextResponse.json({
      exists: !!row,
      status: row ? String(row.status) : null,
    });
  }

  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const days = Math.min(
    180,
    Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30),
  );
  const data = dashboard(g.affiliate.id, days);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ...data, plans: plans() });
}

/** POST /api/partners/me — narrow self-service edits to contact details. */
export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;
  const body = await req.json().catch(() => ({}));

  const { db } = await import("@/app/lib/db");
  db.prepare(
    `UPDATE affiliates SET name = ?, phone = ?, company = ?, website = ?, audience = ?
      WHERE id = ?`,
  ).run(
    String(body?.name ?? g.affiliate.name).slice(0, 120),
    String(body?.phone ?? g.affiliate.phone)
      .replace(/\D/g, "")
      .slice(-10),
    String(body?.company ?? g.affiliate.company).slice(0, 160),
    String(body?.website ?? g.affiliate.website).slice(0, 200),
    String(body?.audience ?? g.affiliate.audience).slice(0, 400),
    g.affiliate.id,
  );

  const { affiliateById } = await import("@/app/lib/affiliates");
  const fresh = affiliateById(g.affiliate.id);
  return NextResponse.json({
    ok: true,
    affiliate: fresh ? publicProfile(fresh) : null,
  });
}
