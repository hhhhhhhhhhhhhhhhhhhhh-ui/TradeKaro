import { NextRequest, NextResponse, after } from "next/server";
import { needPartner } from "../_guard";
import {
  deletePixel,
  pixelsForAffiliate,
  savePixel,
  type AffiliateProvider,
} from "@/app/lib/pixels";
import { encryptionAvailable } from "@/app/lib/pixelCrypto";
import {
  backfillDeliveries,
  buildMetaPayload,
  dispatchPendingConversions,
  providerConfig,
} from "@/app/lib/conversionsDispatch";

// GET    /api/partners/pixels            your pixels (never a token)
// POST   /api/partners/pixels            save one  { provider, pixelId, token?, label? }
// POST   /api/partners/pixels?dryRun=1   show what we would send, sending nothing
// DELETE /api/partners/pixels?provider=  remove one
//
// A token is WRITE-ONLY. It goes in and is never handed back — not to the panel,
// not in an error message, not in the dry-run preview. The only thing that
// crosses back is a four-character hint so a partner can recognise which token
// they pasted.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  return NextResponse.json({
    ok: true,
    pixels: pixelsForAffiliate(g.affiliate.id),
    // Surfaced so the panel can explain why a token was refused, rather than
    // showing a generic failure the partner cannot act on.
    serverSideAvailable: encryptionAvailable(),
    platformConfigured: {
      meta: Boolean(providerConfig().meta.pixelId),
      ga4: Boolean(providerConfig().ga4.measurementId),
    },
  });
}

export async function POST(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  if (dryRun) {
    // A preview of the real payload, built with the partner's own pixel id.
    // Enough to prove the wiring without sending a conversion into their ad
    // account — which would spend their money and teach their ad platform
    // something untrue.
    const pixels = pixelsForAffiliate(g.affiliate.id);
    const meta = pixels.find((p) => p.provider === "meta");
    if (!meta)
      return NextResponse.json(
        { ok: false, error: "Save a Meta pixel first." },
        { status: 400 },
      );

    const cfg = providerConfig().meta;
    const sample = buildMetaPayload(
      {
        event_id: `test:${g.affiliate.code}`,
        name: "PageView",
        user_id: null,
        affiliate_code: g.affiliate.code,
        click_id: null,
        value: null,
        currency: "INR",
        ga_client_id: null,
        occurred_at: Date.now(),
      },
      "",
    );

    return NextResponse.json({
      ok: true,
      // Deliberately reports the endpoint WITHOUT the token — the URL here is
      // built from env, and the partner's own token would be in the real
      // Authorization header, which is omitted.
      endpoint: `${cfg.base}/${cfg.version}/${meta.pixelId}/events`,
      authorizationHeader: meta.hasToken
        ? "Bearer •••• (your token, stored encrypted)"
        : "none — add a token to enable server-side sending",
      payload: sample.body,
    });
  }

  const body = await req.json().catch(() => ({}));
  const res = savePixel({
    affiliateId: g.affiliate.id,
    provider: String(body?.provider || "") as AffiliateProvider,
    pixelId: body?.pixelId,
    token: body?.token,
    clearToken: body?.clearToken === true,
    label: body?.label,
    enabled: body?.enabled !== false,
  });

  if (!res.ok)
    return NextResponse.json(
      { ok: false, error: res.error },
      { status: res.status },
    );

  // A partner who has just added a pixel usually has conversions already on
  // record that were never queued for them. `enqueueDeliveries` only opens a row
  // for a destination that can actually be reached, so at the time those events
  // happened there was nothing to send to and no row was created. Backfill and
  // drain here rather than waiting for the timer, so tracking starts from the
  // moment they add the pixel instead of up to five minutes later.
  //
  // `after()` keeps this off the response — saving a pixel should not wait on
  // Meta. Failures are swallowed: the save already succeeded, and the timer is
  // the reliable path. This is only a head start.
  after(async () => {
    try {
      backfillDeliveries(500);
      await dispatchPendingConversions({ limit: 25 });
    } catch {
      /* the timer will pick the queue up regardless */
    }
  });

  return NextResponse.json({ ok: true, pixel: res.pixel });
}

export async function DELETE(req: NextRequest) {
  const g = await needPartner(req);
  if (!g.ok) return g.response;

  const provider = String(req.nextUrl.searchParams.get("provider") || "");
  const removed = deletePixel(g.affiliate.id, provider);
  return NextResponse.json({ ok: true, removed });
}
