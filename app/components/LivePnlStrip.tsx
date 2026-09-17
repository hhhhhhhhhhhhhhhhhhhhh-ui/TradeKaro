"use client";
import { useLivePnl } from "@/app/hooks/useLivePnl";
import { pnlSigned } from "@/app/lib/format";

// Small amounts keep paise, so this strip and the positions panel never
// disagree about the same number (₹0.50 must not print as ₹1 here, ₹0 there).
const fmt = pnlSigned;

// Demat-style strip: realized + live unrealized + total, one engine,
// same numbers on portfolio, options desk, and positions.
export default function LivePnlStrip({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { realized, unrealized, total, live, updatedAt, positions } =
    useLivePnl();
  const cls = (v: number) => (v >= 0 ? "text-positive" : "text-negative");
  return (
    <div
      className={`broker-card px-3 sm:px-4 py-2.5 flex ${compact ? "flex-row flex-wrap" : "flex-row flex-wrap"} items-center gap-x-4 gap-y-1.5 text-[11px] font-mono`}
      role="status"
      aria-label={`Live profit and loss. Realized ${fmt(realized)}, unrealized ${fmt(unrealized)}, total ${fmt(total)}`}
    >
      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={`live-dot ${live ? "" : "opacity-40"}`} />
        P&L {live ? "· LIVE" : "· DELAYED"}
      </span>
      <span className="display-num">
        <span className="text-foreground/45 mr-1">REAL</span>
        <span className={`font-bold ${cls(realized)}`}>{fmt(realized)}</span>
      </span>
      <span className="display-num">
        <span className="text-foreground/45 mr-1">OPEN</span>
        <span className={`font-bold ${cls(unrealized)}`}>
          {fmt(unrealized)}
        </span>
      </span>
      <span className="display-num text-[13px]">
        <span className="text-foreground/45 mr-1">TOTAL</span>
        <span className={`font-bold ${cls(total)}`}>{fmt(total)}</span>
      </span>
      <span className="text-foreground/40 display-num">
        {positions.length} open
        {updatedAt
          ? ` · ${new Date(updatedAt).toLocaleTimeString("en-IN", { hour12: false })}`
          : ""}
      </span>
      <a href="/portfolio/orders" className="underline text-foreground/60">
        ORDERS →
      </a>
    </div>
  );
}
