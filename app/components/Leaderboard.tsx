"use client";
import { useEffect, useState } from "react";
import { useTradingAccount } from "@/app/lib/trading";
import { moneySigned } from "@/app/lib/format";

// Verified record. Every number here comes from the SERVER's derived
// account (app/lib/tradingServer.ts), which is rebuilt from validated fills only.
// Editing localStorage in devtools changes nothing on this card.
export default function Leaderboard() {
  const acct = useTradingAccount();
  // localStorage/server data is invisible during SSR, so mount-gate the card
  // to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const realized = acct?.realizedPnl ?? 0;
  const win = acct?.winRate ?? 0;
  const fills = acct?.fills ?? 0;
  const open = acct?.openPositions ?? 0;

  return (
    <div className="broker-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Your paper P&amp;L
        </span>
        {mounted && acct ? (
          <span
            className="broker-pill bg-positive/10 text-positive px-1.5 py-px text-[9px] font-mono"
            title="Recomputed on the server from validated fills"
          >
            VERIFIED
          </span>
        ) : null}
      </div>
      <div className="mt-4 divide-y divide-border">
        {mounted ? (
          <div className="py-2.5 flex justify-between text-sm font-mono">
            <span>
              #1 You
              <span className="block text-[11px] text-foreground/50">
                {fills} fills · {open} open · {acct?.wins ?? 0}W/
                {acct?.losses ?? 0}L
              </span>
            </span>
            <span className={realized >= 0 ? "text-positive" : "text-negative"}>
              {moneySigned(realized, 2)} · {win}%
            </span>
          </div>
        ) : (
          <div className="py-2.5">
            <span className="skeleton inline-block h-4 w-32" />
          </div>
        )}
        {mounted && fills === 0 && (
          <div className="py-2.5 text-[12.5px] text-muted-foreground">
            No fills yet — trade stocks or options to build your record.
          </div>
        )}
      </div>
    </div>
  );
}
