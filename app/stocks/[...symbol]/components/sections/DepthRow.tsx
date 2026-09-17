"use client";
import type { BookRow } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import {
  formatPrice,
  formatQty,
} from "@/app/stocks/[...symbol]/components/hooks/bookFormat";
import { pickDepth } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";

export default function DepthRow({
  row,
  side,
  best,
  cum,
  total,
  depthPct,
  levels = 10,
}: {
  row: BookRow;
  side: "bid" | "ask";
  best: boolean;
  cum: number;
  total: number;
  depthPct: number;
  levels?: number;
}) {
  const tone = side === "bid" ? "text-positive" : "text-negative";
  const bar = side === "bid" ? "bg-positive/10" : "bg-negative/10";
  const share = total > 0 ? (row.qty / total) * 100 : 0;
  const click = () =>
    pickDepth(row.price, side === "bid" ? "SELL" : "BUY", row.qty);
  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      click();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${side === "bid" ? "Sell @ " : "Buy @ "}${formatPrice(row.price)}`}
      aria-label={`${side} ${formatPrice(row.price)} qty ${formatQty(row.qty)}`}
      onClick={click}
      onKeyDown={keyDown}
      className={`row-slide pressable relative grid grid-cols-[1fr_auto_auto] items-baseline gap-2 px-3 md:px-4 py-2 md:py-1.5 text-[13px] md:text-sm font-mono tnum cursor-pointer focus:outline-none focus-visible:brand-ring ${
        best ? "bg-muted/60 font-semibold" : ""
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${bar}`}
        style={{ width: `${Math.min(100, depthPct)}%` }}
      />
      <span className={`relative display-num ${best ? tone : ""}`}>
        {formatPrice(row.price)}
      </span>
      <span className={`relative text-right display-num ${tone}`}>
        {formatQty(row.qty)}
      </span>
      <span className="relative hidden sm:block text-right text-[11px] text-foreground/40 w-14">
        {share.toFixed(1)}%
      </span>
      <span className="sr-only">
        cumulative {formatQty(cum)} of {levels} levels
      </span>
    </div>
  );
}
