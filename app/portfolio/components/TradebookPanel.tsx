"use client";
import { useState } from "react";
import {
  getRealizedPnl,
  getTrades,
  type InstrumentKind,
} from "@/app/lib/trading";
import { money, pnlSigned } from "@/app/lib/format";
import { useMounted } from "@/app/hooks/useMounted";
import { useCommodities, venueTag } from "@/app/hooks/useCommodities";

export default function TradebookPanel() {
  const [filter, setFilter] = useState<"ALL" | InstrumentKind>("ALL");
  const [tick, setTick] = useState(0);
  const mounted = useMounted();
  const commodities = useCommodities();
  // Re-read on each render + manual refresh; localStorage is the store.
  // Gated on mount: the server cannot see localStorage, so reading it while
  // rendering made the first client pass disagree with the SSR HTML.
  const all = mounted ? getTrades() : [];
  void tick;
  const realized = mounted ? getRealizedPnl() : 0;
  const rows = all
    .filter((t) => (filter === "ALL" ? true : t.kind === filter))
    .slice()
    .reverse()
    .slice(0, 30);

  return (
    <div className="broker-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-2 justify-between">
        <span className="eyebrow">
          Tradebook · {all.length} fills · Realized{" "}
          <span className={realized >= 0 ? "text-positive" : "text-negative"}>
            {pnlSigned(realized)}
          </span>
        </span>
        <span className="flex gap-1">
          {(["ALL", "STOCK", "OPTION"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`pressable h-8 rounded-md border px-3 text-[11px] font-semibold transition-colors ${filter === f ? "border-transparent bg-foreground text-background" : "border-border bg-card text-foreground/70 hover:bg-muted"}`}
            >
              {f}
            </button>
          ))}
        </span>
      </div>
      {!rows.length ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          No fills yet — place a stock order or fire an option leg.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.slice(0, 10).map((t) => (
            <div
              key={t.id}
              className="px-4 py-2 flex items-center justify-between gap-2 text-[12px] font-mono"
            >
              <span className="min-w-0">
                <span className="font-semibold truncate block">{t.scrip}</span>
                <span className="text-[11px] text-foreground/55 display-num">
                  {t.qty} @ {money(t.price, 2)}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 ${t.side === "BUY" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative"}`}
                >
                  {t.side} · {venueTag(t, commodities)}
                </span>
                <span className="block text-[11px] display-num text-foreground/60">
                  {money(t.value)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
