import { NextResponse } from "next/server";
import { getSettings } from "@/app/lib/adminStore";
import { holidayList, todaySessions } from "@/app/lib/marketInfo";

// Public safe config — no token, no secrets. Polled by clients to
// obey admin polling, lists, chart defaults, market hours, banner.
export async function GET() {
  const s = await getSettings();

  // Today's exchange calendar, so the browser and the order gate resolve
  // "is it open" from the same numbers. Both calls fail soft to null/[] — an
  // unreachable provider must leave the admin window in charge, never look
  // like a market closure.
  const [calendar, holidays] = await Promise.all([
    todaySessions().catch(() => null),
    holidayList().catch(() => []),
  ]);

  return NextResponse.json({
    clientPollMs: s.clientPollMs,
    tradeEngineMs: s.tradeEngineMs,
    hiddenTabPause: s.hiddenTabPause,
    tape: s.tape,
    rail: s.rail,
    chartDefaults: s.chartDefaults,
    marketHours: s.marketHours,
    /** null when the provider is unreachable; callers fall back to marketHours. */
    calendar,
    /** Every closure this year, per exchange — shown in the console. */
    holidays,
    banner: s.banner,
    maintenance: s.maintenance,
    providerOff: s.providerOff,
    orderDefaults: s.orderDefaults,
    trading: {
      startCash: s.trading.startCash,
      maxQty: s.trading.maxQty,
      maxPositions: s.trading.maxPositions,
      marginPct: s.trading.marginPct,
      allowShort: s.trading.allowShort,
      haltFills: s.trading.haltFills,
      allowAfterHours: s.trading.allowAfterHours === true,
      brokerageFlat: s.trading.brokerageFlat,
      brokeragePct: s.trading.brokeragePct,
      autoSquareOff: s.trading.autoSquareOff,
      squareOffTime: s.trading.squareOffTime,
      fractionalLots: s.trading.fractionalLots !== false,
    },
    alertLimits: s.alertLimits,
    kyc: {
      minDeposit: Number(s.kyc?.minDeposit) || 0,
    },
  });
}
