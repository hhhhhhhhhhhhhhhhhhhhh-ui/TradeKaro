"use client";
import { useState } from "react";
import OrderTicket from "@/app/stocks/[...symbol]/components/handlers/OrderTicket";

// Persistent right-side ticket instead of a modal popup.
export default function DockedTicket(props: {
  symbol: string;
  companyName: string;
  ltp: number;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [key, setKey] = useState(0);
  return (
    <div className="border border-border bg-card h-fit sticky top-4">
      <div className="grid grid-cols-2 border-b border-border">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`py-2.5 text-xs font-mono font-semibold ${
              side === s
                ? s === "BUY"
                  ? "bg-positive text-positive-foreground"
                  : "bg-negative text-negative-foreground"
                : "text-foreground/60 hover:bg-muted"
            }`}
          >
            {s} [B/S]
          </button>
        ))}
      </div>
      <OrderTicket
        key={side + key}
        symbol={props.symbol}
        companyName={props.companyName}
        ltp={props.ltp}
        side={side}
        onClose={() => setKey((k) => k + 1)}
      />
    </div>
  );
}
