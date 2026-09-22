"use client";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { FiArrowDownRight, FiArrowUpRight } from "react-icons/fi";

// The four instruments a visitor actually checks first. Deliberately indices
// rather than a stock list: an index level is recognised instantly by someone
// who does not yet know the product, and it moves on the same board the rest of
// the app reads.
const INSTRUMENTS = [
  { symbol: "NIFTY", label: "NIFTY 50" },
  { symbol: "BANKNIFTY", label: "BANK NIFTY" },
  { symbol: "SENSEX", label: "SENSEX" },
  { symbol: "FINNIFTY", label: "FIN NIFTY" },
];

export default function LiveMarketStrip() {
  const { ticks, live } = useLiveTicks(
    INSTRUMENTS.map((i) => i.symbol),
    5000,
  );

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {INSTRUMENTS.map(({ symbol, label }) => {
        const t = ticks[symbol];
        const chg = t?.close ? ((t.ltp - t.close) / t.close) * 100 : null;
        const up = (chg ?? 0) >= 0;
        return (
          <div key={symbol} className="bg-card px-4 py-3.5 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    live ? "bg-positive" : "bg-muted-foreground/40"
                  }`}
                />
                {live ? "Live" : "Offline"}
              </span>
            </div>

            {t ? (
              <>
                <div className="display-num mt-2 text-lg font-semibold text-foreground">
                  {Number(t.ltp).toLocaleString("en-IN", {
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div
                  className={`mt-0.5 flex items-center gap-1 text-[11.5px] font-medium ${
                    up ? "text-positive" : "text-negative"
                  }`}
                >
                  {up ? (
                    <FiArrowUpRight size={13} aria-hidden />
                  ) : (
                    <FiArrowDownRight size={13} aria-hidden />
                  )}
                  <span className="display-num">
                    {up ? "+" : ""}
                    {(chg ?? 0).toFixed(2)}%
                  </span>
                </div>
              </>
            ) : (
              // Two placeholder rows the same height as the real ones, so the
              // strip does not jump when the first tick lands.
              <div className="mt-2 space-y-1.5 py-[1px]">
                <div className="skeleton h-[22px] w-24 rounded" />
                <div className="skeleton h-[14px] w-16 rounded" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
