"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { apiURL } from "@/app/components/apiURL";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { toCloseSeries } from "@/app/lib/candles";

// ── Live sparkline driven by Upstox candles (no hardcoded points) ──
function toPath(data: number[], width: number, height: number): string {
  if (!data.length) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = height * 0.08;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });
  return "M " + points.join(" L ");
}

export function LiveSpark({
  symbol = "RELIANCE",
  w = 240,
  h = 56,
  id = "sg-live",
}: {
  symbol?: string;
  w?: number;
  h?: number;
  id?: string;
}) {
  const [pts, setPts] = useState<number[]>([]);
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch("/api/market/candles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, interval: "day" }),
        });
        const j = await r.json();
        // Candles arrive as OHLC objects; sparklines only need closes.
        const closes: number[] = toCloseSeries(j?.candles)
          .map((c) => c[1])
          .filter((n) => Number.isFinite(n))
          .slice(-20);
        if (!stop && closes.length >= 2) setPts(closes);
      } catch {
        /* keep empty */
      }
    })();
    return () => {
      stop = true;
    };
  }, [symbol]);
  if (pts.length < 2)
    return (
      <div
        className="skeleton h-14 w-full max-w-[240px]"
        aria-label="Loading chart"
      />
    );
  const path = toPath(pts, w, h);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      className="w-full max-w-[240px]"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="rgb(var(--positive))"
            stopOpacity="0.18"
          />
          <stop
            offset="100%"
            stopColor="rgb(var(--positive))"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <path d={path + ` L ${w},${h} L 0,${h} Z`} fill={`url(#${id})`} />
      <path
        d={path}
        stroke="rgb(var(--positive))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LiveRelianceCard() {
  const { ticks, live } = useLiveTicks(["RELIANCE"], 8000);
  const t = ticks["RELIANCE"];
  if (!t)
    return (
      <div className="flex flex-col gap-1 pb-1">
        <span className="font-mono text-xs text-muted-foreground">
          RELIANCE · {live ? "LOADING" : "OFFLINE"}
        </span>
        <span className="skeleton inline-block h-6 w-28" />
      </div>
    );
  const chg = t.close ? ((t.ltp - t.close) / t.close) * 100 : 0;
  const up = chg >= 0;
  return (
    <div className="flex flex-col gap-1 pb-1">
      <span className="font-mono text-xs text-muted-foreground">
        RELIANCE · LIVE UPSTOX
      </span>
      <span className="font-mono text-lg font-semibold text-foreground">
        ₹{Number(t.ltp).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
      </span>
      <span
        className="font-mono text-xs"
        style={{ color: up ? "rgb(var(--positive))" : "rgb(var(--negative))" }}
      >
        {up ? "+" : ""}
        {chg.toFixed(2)}% today
      </span>
    </div>
  );
}

export function LiveWatchlist({
  symbols = ["TCS", "TATAMOTORS", "BAJFINANCE", "SUNPHARMA"],
}: {
  symbols?: string[];
}) {
  const { ticks } = useLiveTicks(symbols, 8000);
  return (
    <div className="border border-border bg-background divide-y divide-border">
      {symbols.map((s) => {
        const t = ticks[s];
        return (
          <Link
            key={s}
            href={`/stocks/${s}`}
            className="flex items-center justify-between px-3 sm:px-4 py-2.5 hover:bg-muted transition-colors"
          >
            <span className="font-mono text-xs font-semibold text-foreground">
              {s}
            </span>
            {t ? (
              <span className="font-mono text-xs text-muted-foreground">
                ₹
                {Number(t.ltp).toLocaleString("en-IN", {
                  maximumFractionDigits: 2,
                })}
              </span>
            ) : (
              <span className="skeleton inline-block h-3 w-16" />
            )}
          </Link>
        );
      })}
      <div className="flex items-center px-3 sm:px-4 py-2.5">
        <span className="font-mono text-xs text-muted-foreground">
          + ADD SCRIP
        </span>
      </div>
    </div>
  );
}

export function LiveMovers() {
  const [g, setG] = useState<any[]>([]);
  const [l, setL] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const d = await axios.post(`${apiURL}/topmovers`, { size: 10 });
        if (stop) return;
        setG((d.data?.TOP_GAINERS?.items || []).slice(0, 3));
        setL((d.data?.TOP_LOSERS?.items || []).slice(0, 3));
      } catch {
        /* keep empty */
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);
  if (loading)
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((c) => (
          <div key={c} className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skeleton inline-block h-4 w-20" />
            ))}
          </div>
        ))}
      </div>
    );
  if (!g.length && !l.length)
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Movers unavailable right now — try /topmovers.
      </p>
    );
  const cell = (it: any) => {
    const sym = it.company?.nseScriptCode || it.symbol || "?";
    const pct = Number(it.stats?.dayChangePerc ?? 0);
    return (
      <Link
        key={sym}
        href={`/stocks/${sym}`}
        className="flex flex-col hover:opacity-80"
      >
        <span className="font-mono text-[11px] font-semibold text-foreground leading-tight">
          {sym}
        </span>
        <span
          className="font-mono text-[11px]"
          style={{
            color: pct >= 0 ? "rgb(var(--positive))" : "rgb(var(--negative))",
          }}
        >
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      </Link>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div
          className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide"
          style={{ color: "rgb(var(--positive))" }}
        >
          GAINERS · LIVE
        </div>
        <div className="flex flex-col gap-1.5">{g.map(cell)}</div>
      </div>
      <div>
        <div
          className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide"
          style={{ color: "rgb(var(--negative))" }}
        >
          LOSERS · LIVE
        </div>
        <div className="flex flex-col gap-1.5">{l.map(cell)}</div>
      </div>
    </div>
  );
}
