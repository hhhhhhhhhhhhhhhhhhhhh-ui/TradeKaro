"use client";
import { useEffect, useState } from "react";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { broadMarketStatus } from "@/app/lib/marketClock";

// Market status row: LIVE pill + NIFTY/SENSEX/BANKNIFTY live ticks + IST clock.
export default function MarketStatusRow() {
  const [now, setNow] = useState<Date | null>(null);
  const { marketHours, calendar } = usePublicConfig();
  const { ticks, live } = useLiveTicks(["NIFTY", "SENSEX", "BANKNIFTY"], 8000);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Across every segment we trade. Asking about NSE alone said "CLOSED" all
  // evening while MCX was open.
  const st = now
    ? broadMarketStatus(marketHours, now, calendar)
    : { label: "…", live: false };
  const clock = now
    ? now.toLocaleTimeString("en-IN", {
        hour12: false,
        timeZone: "Asia/Kolkata",
      })
    : "…";
  const date = now
    ? now.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      })
    : "";

  const cards = ["NIFTY", "SENSEX", "BANKNIFTY"].map((s) => {
    const t = ticks[s];
    const up = t ? t.ltp >= (t.close ?? t.ltp) : true;
    return { s, t, up };
  });

  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${st.live ? "bg-positive live-dot" : "bg-negative"}`}
          />
          <span className="text-xs font-mono text-foreground/80 tracking-wider">
            {st.label}
          </span>
          <span className="hidden sm:inline text-[11px] font-mono text-foreground/40">
            · UPSTOX {live ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        <div
          className="text-[11px] text-muted-foreground tabular-nums"
          suppressHydrationWarning
        >
          {date} · IST {clock}
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border">
        {cards.map(({ s, t, up }) => (
          <a
            key={s}
            href={`/stocks/${s}`}
            className="p-3 md:p-4 hover:bg-muted transition min-w-0"
          >
            <div className="eyebrow">{s}</div>
            {t ? (
              <>
                <div className="display-num text-base md:text-xl font-semibold truncate">
                  {Number(t.ltp).toLocaleString("en-IN", {
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div
                  className={`text-[11px] font-mono ${up ? "text-positive" : "text-negative"}`}
                >
                  {up ? "▲" : "▼"} live
                </div>
              </>
            ) : (
              <>
                <div className="h-5 w-20 bg-foreground/10 mt-1" />
                <div className="h-3 w-12 bg-foreground/10 mt-1.5" />
              </>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
