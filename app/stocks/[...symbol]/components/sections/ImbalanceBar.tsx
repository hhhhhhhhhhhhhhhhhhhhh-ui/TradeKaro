"use client";

// Bid-vs-ask pressure bar: share of top-N qty on each side.
export default function ImbalanceBar({
  totBid,
  totAsk,
}: {
  totBid: number;
  totAsk: number;
}) {
  const total = totBid + totAsk;
  const bidPct = total > 0 ? (totBid / total) * 100 : 50;
  const imb = total > 0 ? ((totBid - totAsk) / total) * 100 : 0;
  return (
    <div className="px-4 md:px-6 py-2.5 border-b border-border">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
        <span className="text-positive">BID {bidPct.toFixed(0)}%</span>
        <span className={imb >= 0 ? "text-positive" : "text-negative"}>
          IMB {imb >= 0 ? "+" : ""}
          {imb.toFixed(1)}%
        </span>
        <span className="text-negative">ASK {(100 - bidPct).toFixed(0)}%</span>
      </div>
      <div
        className="flex h-1.5 w-full overflow-hidden broker-pill bg-muted"
        role="img"
        aria-label={`Bid ask imbalance ${imb.toFixed(1)} percent`}
      >
        <div
          className="bg-positive transition-all"
          style={{ width: `${bidPct}%` }}
        />
        <div
          className="bg-negative transition-all"
          style={{ width: `${100 - bidPct}%` }}
        />
      </div>
    </div>
  );
}
