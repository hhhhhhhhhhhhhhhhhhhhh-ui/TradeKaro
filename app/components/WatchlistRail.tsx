"use client";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import Sparkline from "@/app/components/Sparkline";

const FALLBACK_RAIL = [
  "NIFTY",
  "BANKNIFTY",
  "RELIANCE",
  "TCS",
  "INFY",
  "SBIN",
  "HDFCBANK",
  "TATAMOTORS",
];

// Slim Kite-style rail: scrip, spark, LTP, chg. Click swaps the chart page.
export default function WatchlistRail({ active }: { active?: string }) {
  const { rail } = usePublicConfig();
  const DEFAULTS = rail?.length ? rail : FALLBACK_RAIL;
  const { ticks: quotes } = useLiveTicks(DEFAULTS, 8000);

  return (
    <aside className="hidden lg:block w-64 shrink-0 border border-border bg-card h-fit sticky top-4">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Watchlist · NSE
      </div>
      <div className="divide-y divide-border">
        {DEFAULTS.map((s) => {
          const q = quotes[s];
          const up = (q?.ltp ?? 0) >= (q?.close ?? q?.ltp ?? 0);
          return (
            <a
              key={s}
              href={`/stocks/${s}`}
              className={`density-row flex items-center gap-2 px-4 py-2.5 hover:bg-muted ${active === s ? "bg-muted" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{s}</div>
                <div className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {q ? (
                    `₹${Number(q.ltp).toFixed(2)}`
                  ) : (
                    <span className="skeleton inline-block h-3 w-12" />
                  )}
                </div>
              </div>
              <Sparkline
                data={[
                  q?.low ?? 0,
                  q?.open ?? 0,
                  q?.close ?? 0,
                  q?.high ?? 0,
                  q?.ltp ?? 0,
                ]}
                positive={up}
              />
              <span
                className={`tnum font-mono text-[11px] tabular-nums ${up ? "text-positive" : "text-negative"}`}
              >
                {q?.close
                  ? (((q.ltp - q.close) / q.close) * 100).toFixed(2) + "%"
                  : "—"}
              </span>
            </a>
          );
        })}
      </div>
    </aside>
  );
}
