import { NextRequest, NextResponse } from "next/server";
import {
  backfillDeliveries,
  configuredProviders,
  deliverySummary,
  dispatchPendingConversions,
  requeueDeliveries,
} from "@/app/lib/conversionsDispatch";
import { enabledPartnerPixelCount } from "@/app/lib/pixels";

// POST /api/track/dispatch — send what is owed to Meta and Google.
//
//   POST /api/track/dispatch                      drain the queue (bounded)
//   POST /api/track/dispatch?limit=200            drain more
//   POST /api/track/dispatch?dryRun=1             build the payloads, send nothing
//   POST /api/track/dispatch?backfill=1           queue events recorded before
//                                                 credentials existed
//   POST /api/track/dispatch?requeue=1            retry what is terminal, after
//                                                 fixing a token or pixel id
//   GET  /api/track/dispatch                      what is owed, by status
//
// DELIBERATELY NOT PUBLIC. Sending conversion data is an action with real
// consequences — it spends money by telling an ad platform to chase a customer —
// so it sits behind a shared secret rather than being a URL anyone can poke.
//
// `TRACKING_DISPATCH_SECRET` must be set. With no secret configured this refuses
// everything rather than running unauthenticated: an endpoint that falls open
// when a variable is missing is worse than one that is unavailable.
//
// TWO WAYS THIS GETS CALLED, and they are complementary:
//
//   • a systemd timer or cron, for reliability, and
//   • opportunistically from the click route's `after()`, so the queue still
//     drains on a host where nobody set up a timer.
//
// Whichever runs, the work is idempotent — attempts are counted on the delivery
// row, so a double call sends nothing twice.

export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.TRACKING_DISPATCH_SECRET || "";
  if (!secret) return false;

  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-dispatch-secret") ||
    req.nextUrl.searchParams.get("secret") ||
    "";
  return header.length > 0 && header === secret;
}

export async function GET(req: NextRequest) {
  if (!authorised(req))
    return NextResponse.json(
      { ok: false, error: "not authorised" },
      { status: 401 },
    );

  return NextResponse.json({
    ok: true,
    configured: configuredProviders(),
    summary: deliverySummary(),
  });
}

export async function POST(req: NextRequest) {
  if (!authorised(req))
    return NextResponse.json(
      { ok: false, error: "not authorised" },
      { status: 401 },
    );

  const sp = req.nextUrl.searchParams;
  const dryRun = sp.get("dryRun") === "1";
  const limit = Number(sp.get("limit") || 25);

  // An explicit operator action is honoured whatever the configuration says.
  // `requeue` exists to undo a previous decision, and it was previously
  // documented here but never actually wired up — the recovery path an operator
  // would reach for after fixing a rotated token did nothing at all.
  let requeued = 0;
  if (sp.get("requeue") === "1") requeued = requeueDeliveries();

  // Nothing to send and nothing that could be sent — answer without touching the
  // queue. This cannot be `configuredProviders()` alone: a partner's pixel is a
  // reason to run even when the platform has no pixel of its own, because their
  // conversions still need forwarding.
  //
  // A timer calls this on a fixed schedule, so the idle case has to be the cheap
  // one. Checking a count is a single indexed query; draining is not.
  const configured = configuredProviders();
  const partnerPixels = enabledPartnerPixelCount();
  if (!configured.length && partnerPixels === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "nothing_configured",
      configured,
      partnerPixels,
      requeued,
    });
  }

  let backfilled = 0;
  if (sp.get("backfill") === "1") backfilled = backfillDeliveries(500).queued;

  const report = await dispatchPendingConversions({
    limit: Number.isFinite(limit) ? limit : 25,
    dryRun,
  });

  return NextResponse.json({
    ok: true,
    backfilled,
    requeued,
    partnerPixels,
    ...report,
  });
}
