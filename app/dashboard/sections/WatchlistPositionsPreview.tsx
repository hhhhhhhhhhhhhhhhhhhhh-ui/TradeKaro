"use client";
import { useEffect, useMemo, useState } from "react";
import { getWLs } from "@/app/lib/watchlists";
import { getPositions } from "@/app/lib/trading";
import { getPending } from "@/app/lib/pendingOrders";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import Sparkline from "@/app/components/Sparkline";
import EmptyState from "@/app/dashboard/components/EmptyState";

// Watchlist + open positions/orders preview cards for the dashboard.
export default function WatchlistPositionsPreview() {
  const [watchSyms, setWatchSyms] = useState<string[]>([]);
  const [posCount, setPosCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [gttCount, setGttCount] = useState(0);

  useEffect(() => {
    try {
      const wls = getWLs();
      const syms = wls.flatMap((w) => w.symbols).slice(0, 5);
      setWatchSyms(syms);
    } catch {
      setWatchSyms([]);
    }
    try {
      setPosCount(getPositions().length);
    } catch {
      setPosCount(0);
    }
    try {
      const p = getPending();
      setPendingCount(p.filter((o) => o.status === "PENDING").length);
      setGttCount(
        p.filter((o) => o.status === "PENDING" && o.orderType === "GTT").length,
      );
    } catch {
      setPendingCount(0);
      setGttCount(0);
    }
  }, []);

  const syms = useMemo(
    () => watchSyms.map((s) => s.toUpperCase()),
    [watchSyms],
  );
  const { ticks } = useLiveTicks(syms, 6000);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Watchlist preview */}
      <div className="broker-card broker-card-hover overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="eyebrow">Watchlist</span>
          <NavTransition
            href="/watchlist"
            className="text-xs font-mono text-brand hover:underline pressable"
          >
            VIEW ALL →
          </NavTransition>
        </div>
        {watchSyms.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No symbols yet"
              hint="Pin NIFTY, BANKNIFTY, RELIANCE to track here"
              href="/watchlist"
              actionLabel="Add first →"
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {watchSyms.map((s) => {
              const t = ticks[s.toUpperCase()];
              const up = t ? t.ltp >= (t.close ?? t.ltp) : true;
              const spark = t ? [Number(t.close ?? t.ltp), Number(t.ltp)] : [];
              return (
                <NavTransition
                  key={s}
                  href={`/stocks/${encodeURIComponent(s)}`}
                  className="row-slide flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted transition"
                >
                  <span className="text-sm font-mono font-medium">{s}</span>
                  <span className="flex items-center gap-3">
                    {spark.length > 1 && (
                      <span className="hidden sm:block">
                        <Sparkline data={spark} positive={up} id={`wl-${s}`} />
                      </span>
                    )}
                    {t ? (
                      <span
                        className={`display-num text-sm ${up ? "text-positive" : "text-negative"}`}
                      >
                        ₹{Number(t.ltp).toFixed(2)}
                      </span>
                    ) : (
                      <span className="skeleton inline-block h-4 w-16" />
                    )}
                  </span>
                </NavTransition>
              );
            })}
          </div>
        )}
      </div>

      {/* Positions / orders preview */}
      <div className="broker-card broker-card-hover overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="eyebrow">Positions · Orders</span>
          <NavTransition
            href="/portfolio"
            className="text-xs font-mono text-brand hover:underline"
          >
            OPEN →
          </NavTransition>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border">
          {[
            { label: "Open pos.", value: String(posCount), href: "/portfolio" },
            {
              label: "Pending",
              value: String(pendingCount),
              href: "/portfolio/orders",
            },
            {
              label: "GTT",
              value: String(gttCount),
              href: "/portfolio/orders",
            },
          ].map((c) => (
            <NavTransition
              key={c.label}
              href={c.href}
              className="pressable p-4 hover:bg-muted transition text-center"
            >
              <div className="display-num text-2xl font-semibold">
                {c.value}
              </div>
              <div className="eyebrow mt-1">{c.label}</div>
            </NavTransition>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2">
          <NavTransition
            href="/options"
            className="inline-flex items-center h-[30px] px-3 text-[11px] font-mono border border-border hover:border-foreground transition"
          >
            OPTIONS →
          </NavTransition>
          <NavTransition
            href="/screener"
            className="inline-flex items-center h-[30px] px-3 text-[11px] font-mono border border-border hover:border-foreground transition"
          >
            SCREENER →
          </NavTransition>
          <NavTransition
            href="/topmovers"
            className="inline-flex items-center h-[30px] px-3 text-[11px] font-mono border border-border hover:border-foreground transition"
          >
            TOP MOVERS →
          </NavTransition>
        </div>
      </div>
    </div>
  );
}
