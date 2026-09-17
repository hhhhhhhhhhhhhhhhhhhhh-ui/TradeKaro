"use client";
import { useEffect, useState } from "react";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { marketStatusLabel, isMarketLive } from "@/app/lib/marketClock";

// Bottom broker status bar: clock, market state, data source.
export default function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);
  const { marketHours, calendar } = usePublicConfig();
  const { live } = useLiveTicks(["NIFTY"], 8000);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  // One shared session clock (app/lib/marketClock.ts) — the same one the order
  // gate uses, so this bar can never claim the market is open while orders are
  // being refused.
  const st = now ? marketStatusLabel(marketHours, now, "NSE", calendar) : "…";
  const isLive = now ? isMarketLive(marketHours, now, "NSE", calendar) : false;
  return (
    <div
      className="hidden md:block fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-8 max-w-7xl items-center justify-between px-4 text-[11px] sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2 w-2 ${isLive ? "bg-positive" : "bg-negative"}`}
          />
          <span className="text-foreground/80">{st}</span>
          <span
            className="hidden sm:inline text-foreground/40"
            suppressHydrationWarning
          >
            IST{" "}
            {now
              ? now.toLocaleTimeString("en-IN", {
                  hour12: false,
                  timeZone: "Asia/Kolkata",
                })
              : "…"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-foreground/60">
          {/* Delayed = we are serving the provider's snapshot because the live
              socket is down, not that the provider is unreachable. */}
          <span
            className={live ? undefined : "text-negative"}
            title={
              live
                ? "Live WebSocket feed connected"
                : "Live feed unavailable — showing delayed snapshot prices"
            }
          >
            UPSTOX {live ? "· LIVE" : "· DELAYED"}
          </span>
          <span className="hidden sm:inline">NSE · BSE</span>
        </div>
      </div>
    </div>
  );
}
