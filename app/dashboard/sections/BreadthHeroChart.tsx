"use client";
import { useEffect, useMemo, useState } from "react";
import ProChart from "@/app/stocks/[...symbol]/components/charts/ProChart";
import Loading from "@/app/components/Loading";
import { toCloseSeries } from "@/app/lib/candles";

// Market breadth (advances vs declines) + NIFTY hero chart.
export default function BreadthHeroChart(props: { topMovers: any }) {
  const [candles, setCandles] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Upstox-only NIFTY daily candles (the legacy /getCandles proxy is gone).
      try {
        const r = await fetch("/api/market/candles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: "NIFTY", interval: "day" }),
        });
        const j = await r.json();
        // Route returns OHLC objects; ProChart wants [time, close] tuples.
        if (!cancelled) setCandles(toCloseSeries(j?.candles));
      } catch {
        if (!cancelled) setCandles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const breadth = useMemo(() => {
    const tm = props.topMovers || {};
    let adv = 0;
    let dec = 0;
    // Shape A (dashboard /getTopMovers): TOP_GAINERS.{LARGECAP,MIDCAP,SMALLCAP}.items
    // Shape B (generic /topmovers): TOP_GAINERS.items flat array
    for (const [key, bucket] of [
      ["gainers", tm.TOP_GAINERS],
      ["losers", tm.TOP_LOSERS],
    ] as const) {
      if (!bucket) continue;
      const caps = ["LARGECAP", "MIDCAP", "SMALLCAP"];
      let counted = false;
      for (const cap of caps) {
        const items = (bucket as any)?.[cap]?.items;
        if (Array.isArray(items)) {
          counted = true;
          if (key === "gainers") adv += items.length;
          else dec += items.length;
        }
      }
      if (!counted && Array.isArray((bucket as any)?.items)) {
        if (key === "gainers") adv += (bucket as any).items.length;
        else dec += (bucket as any).items.length;
      }
    }
    // No fake counts: if the payload shape differs, show 0/0 rather than
    // inventing 60/40 breadth.
    const total = adv + dec;
    return { adv, dec, advPct: total ? Math.round((adv / total) * 100) : 50 };
  }, [props.topMovers]);

  const lastClose =
    candles.length && Number.isFinite(candles[candles.length - 1][1])
      ? candles[candles.length - 1][1]
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Breadth bar */}
      <div className="broker-card broker-card-hover p-4 md:p-5 lg:col-span-2">
        <div className="eyebrow mb-3">Breadth</div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-mono text-positive">
            ▲ {breadth.adv} advances
          </span>
          <span className="text-sm font-mono text-negative">
            ▼ {breadth.dec} declines
          </span>
        </div>
        <div
          className="flex h-3 w-full overflow-hidden border border-border"
          role="img"
          aria-label={`${breadth.adv} advances vs ${breadth.dec} declines`}
        >
          <div
            className="bg-positive transition-all"
            style={{ width: `${breadth.advPct}%` }}
          />
          <div
            className="bg-negative transition-all"
            style={{ width: `${100 - breadth.advPct}%` }}
          />
        </div>
        <div className="mt-2 text-[11.5px] text-muted-foreground">
          {breadth.advPct}% advancing · large/mid/small caps
        </div>
      </div>

      {/* NIFTY hero chart */}
      <div className="broker-card overflow-hidden p-4 md:p-5 lg:col-span-3 relative">
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">Nifty · 1D</span>
          {lastClose !== null && (
            <span className="display-num text-sm font-semibold">
              {Number(lastClose).toLocaleString("en-IN", {
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-[180px] md:h-[220px] flex items-center justify-center">
            <Loading />
          </div>
        ) : candles.length ? (
          <div className="h-[180px] md:h-[220px] w-full">
            <ProChart data={candles} height={170} desktopHeight={210} />
          </div>
        ) : (
          <div className="flex h-[180px] items-center justify-center text-[13px] text-muted-foreground md:h-[220px]">
            Chart unavailable — check connection.
          </div>
        )}
      </div>
    </div>
  );
}
