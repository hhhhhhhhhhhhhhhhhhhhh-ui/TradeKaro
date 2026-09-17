"use client";
import { useEffect, useState } from "react";
import { getTrades, type TradeEntry } from "@/app/lib/trading";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";

// Your fills for this scrip, with live P&L vs current LTP.
export default function TradesOnChart({ symbol }: { symbol: string }) {
  const sym = String(symbol || "").toUpperCase();
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const { ticks } = useLiveTicks([sym], 8000);
  const ltp = ticks[sym]?.ltp ?? 0;

  useEffect(() => {
    const load = () =>
      setTrades(
        getTrades()
          .filter((t) => String(t.scrip || "").toUpperCase() === sym)
          .sort((a, b) => b.at - a.at),
      );
    load();
    window.addEventListener("fs-ledger", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("fs-ledger", load);
      window.removeEventListener("storage", load);
    };
  }, [sym]);

  if (!trades.length) return null;

  return (
    <div className="mt-3 border border-border bg-card">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your trades · {sym} ({trades.length})
        </span>
        {ltp ? (
          <span className="text-[11px] font-mono text-foreground/60">
            LTP ₹{Number(ltp).toFixed(2)}
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-border/60 max-h-[220px] overflow-auto">
        {trades.slice(0, 20).map((t) => {
          const buy = t.side === "BUY";
          const pnl = ltp ? (ltp - t.price) * t.qty * (buy ? 1 : -1) : 0;
          return (
            <div
              key={t.id}
              className="px-4 py-2 flex items-center justify-between gap-3 text-xs font-mono"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                    buy
                      ? "bg-positive/15 text-positive"
                      : "bg-negative/15 text-negative"
                  }`}
                >
                  {t.side}
                </span>
                <span className="text-foreground/70">
                  {t.qty} @ ₹{Number(t.price).toFixed(2)}
                </span>
                <span className="text-foreground/40 hidden sm:inline">
                  {new Date(t.at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
              {ltp ? (
                <span className={pnl >= 0 ? "text-positive" : "text-negative"}>
                  {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
