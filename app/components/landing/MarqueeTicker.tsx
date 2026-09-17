"use client";
import Link from "next/link";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";

const SYMBOLS = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "SBIN",
  "TATAMOTORS",
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "SENSEX",
];

function Chip({
  symbol,
  price,
  change,
}: {
  symbol: string;
  price: string;
  change: string;
}) {
  const positive = change.startsWith("+");
  return (
    <Link
      href={`/stocks/${symbol}`}
      className="inline-flex items-center gap-3 px-4 py-2 border-r border-border shrink-0 hover:bg-muted transition-colors"
    >
      <span className="font-mono text-xs font-semibold text-foreground tracking-wider">
        {symbol}
      </span>
      <span className="font-mono text-xs text-foreground/70">₹{price}</span>
      <span
        className="font-mono text-xs font-medium"
        style={{
          color: positive ? "rgb(var(--positive))" : "rgb(var(--negative))",
        }}
      >
        {change}
      </span>
    </Link>
  );
}

export default function MarqueeTicker() {
  const { ticks, live } = useLiveTicks(SYMBOLS, 8000);
  const items = SYMBOLS.map((s) => {
    const t = ticks[s];
    if (!t) return { symbol: s, price: "—", change: live ? "…" : "offline" };
    const chg = t.close ? ((t.ltp - t.close) / t.close) * 100 : 0;
    const sign = chg >= 0 ? "+" : "";
    return {
      symbol: s,
      price: Number(t.ltp).toLocaleString("en-IN", {
        maximumFractionDigits: 2,
      }),
      change: `${sign}${chg.toFixed(2)}%`,
    };
  });
  const doubled = [...items, ...items];
  return (
    <div className="w-full overflow-hidden border-y border-border bg-card group">
      <div
        className="flex"
        style={{
          animation: "marquee 40s linear infinite",
          width: "max-content",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.animationPlayState =
            "paused";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.animationPlayState =
            "running";
        }}
      >
        {doubled.map((t, i) => (
          <Chip key={i} {...t} />
        ))}
      </div>
    </div>
  );
}
