import { NextResponse } from "next/server";
import { livePartner, partnerTokenFromRequest } from "@/app/lib/affiliateAuth";
import { affiliateById, type Affiliate } from "@/app/lib/affiliates";

// Shared gate for every /api/partners route.
//
// Reads `partner_token` ONLY. A signed-in trader hitting these endpoints gets
// 401, which is the point of keeping the two identity systems apart.

export async function partnerFrom(req: Request): Promise<Affiliate | null> {
  const token = await partnerTokenFromRequest(req);
  const claims = await livePartner(token);
  if (!claims) return null;
  return affiliateById(claims.id);
}

export function deny(message = "Not signed in", status = 401) {
  return NextResponse.json({ error: message }, { status });
}

export type Guarded =
  | { ok: true; affiliate: Affiliate }
  | { ok: false; response: NextResponse };

/** `const g = await needPartner(req); if (!g.ok) return g.response;` */
export async function needPartner(req: Request): Promise<Guarded> {
  const affiliate = await partnerFrom(req);
  if (!affiliate) return { ok: false, response: deny() };
  if (affiliate.status !== "approved")
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Your partner account is not active yet",
          status: affiliate.status,
        },
        { status: 403 },
      ),
    };
  return { ok: true, affiliate };
}
