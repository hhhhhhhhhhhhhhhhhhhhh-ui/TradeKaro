"use client";

// Mid-price divider: best bid → mid → best ask with spread chip.
export default function MidPriceRow({
  bestBid,
  bestAsk,
}: {
  bestBid: number;
  bestAsk: number;
}) {
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  return (
    <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2 border-y border-border bg-muted/50">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Mid
      </span>
      <span className="display-num text-sm font-semibold">
        {mid
          ? `₹${mid.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "—"}
      </span>
      <span className="broker-pill inline-flex items-center px-2 py-0.5 text-[10px] font-mono border border-border bg-card text-foreground/60">
        SPR ₹{Number.isFinite(spread) ? spread.toFixed(2) : "—"}
      </span>
    </div>
  );
}
