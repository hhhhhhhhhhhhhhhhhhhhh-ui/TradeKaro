"use client";
import { useEffect, useMemo, useState } from "react";
import { getPositions, getRealizedPnl, type TradePos } from "@/app/lib/trading";
import { useLiveTicks, type Tick } from "@/app/hooks/useLiveTicks";

// Shared live P&L engine: one chain fetch per underlying+expiry group,
// refreshed on the chain TTL, so every surface shows the same MTM.
export type LivePnl = {
  realized: number;
  unrealized: number;
  total: number;
  optPx: Record<string, number>;
  // Full Tick, not a narrowed { ltp } — the store already carries depth, OHLC
  // and volume, and the position detail sheet renders all three.
  ticks: Record<string, Tick>;
  live: boolean;
  updatedAt: number | null;
  positions: TradePos[];
  refresh: () => void;
};

export function optKeyFor(p: TradePos): string {
  return `${p.underlying}|${p.expiry || ""}|${p.strike}${p.optionSide}`;
}

export function livePriceFor(
  p: TradePos,
  optPx: Record<string, number>,
  stockLtp?: number,
): number {
  if (p.kind === "OPTION") {
    const v = optPx[optKeyFor(p)];
    if (typeof v === "number" && v > 0) return v;
    return p.avg;
  }
  return stockLtp ?? p.avg;
}

export function useLivePnl(): LivePnl {
  const [optPx, setOptPx] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const h = () => setRev((t) => t + 1);
    window.addEventListener("storage", h);
    window.addEventListener("fs-ledger", h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener("fs-ledger", h);
    };
  }, []);

  const positions = useMemo(() => {
    try {
      return getPositions();
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const stockSyms = useMemo(
    () =>
      positions
        .filter((p) => p.kind !== "OPTION")
        .map((p) => p.scrip.toUpperCase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(
        positions.map((p) => p.scrip + p.kind + (p.product ?? "")),
      ),
    ],
  );
  const { ticks, live: ticksLive } = useLiveTicks(stockSyms, 8000);

  const groupKey = useMemo(() => {
    const m = new Map<string, { u: string; e?: string }>();
    for (const p of positions) {
      if (p.kind === "OPTION" && p.underlying)
        m.set(`${p.underlying}|${p.expiry || ""}`, {
          u: p.underlying,
          e: p.expiry,
        });
    }
    return JSON.stringify([...m.values()].slice(0, 3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(positions.map((p) => p.scrip + p.kind + (p.product ?? ""))),
  ]);

  useEffect(() => {
    let stop = false;
    const groups = JSON.parse(groupKey) as { u: string; e?: string }[];
    if (!groups.length) {
      setOptPx({});
      return;
    }
    async function load() {
      const out: Record<string, number> = {};
      for (const { u, e } of groups) {
        try {
          const r = await fetch("/api/market/optionchain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ underlying: u, expiry: e || "" }),
          });
          const j = await r.json();
          for (const row of j.rows || []) {
            out[`${u}|${j.expiry || e || ""}|${row.strike}CE`] = row.ceLtp;
            out[`${u}|${j.expiry || e || ""}|${row.strike}PE`] = row.peLtp;
          }
        } catch {
          /* keep last */
        }
      }
      if (!stop && Object.keys(out).length) {
        setOptPx(out);
        setUpdatedAt(Date.now());
      }
    }
    load();
    const id = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [groupKey]);

  const realized = useMemo(() => {
    try {
      return getRealizedPnl();
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(
      positions.map((p) => p.scrip + p.qty + (p.product ?? "") + (p.avg ?? "")),
    ),
    rev,
  ]);

  const unrealized = useMemo(() => {
    let u = 0;
    for (const p of positions) {
      const ltp = livePriceFor(p, optPx, ticks[p.scrip.toUpperCase()]?.ltp);
      u += (ltp - p.avg) * p.qty;
    }
    return u;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(positions), JSON.stringify(optPx), JSON.stringify(ticks)]);

  // Positions and realized P&L live in localStorage, so the server cannot know
  // them. Rendering them on the very first client pass produced a hydration
  // text mismatch (React #418: server said +₹0.00, client said +₹0.50). Gate on
  // mount so the first render matches the server HTML, then fill in at once.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return {
    realized: mounted ? realized : 0,
    unrealized: mounted ? unrealized : 0,
    total: mounted ? realized + unrealized : 0,
    optPx: mounted ? optPx : {},
    ticks: mounted ? ticks : {},
    live:
      mounted &&
      (ticksLive || Object.keys(optPx).length > 0 || positions.length === 0),
    updatedAt: mounted ? updatedAt : null,
    positions: mounted ? positions : [],
    refresh: () => setRev((t) => t + 1),
  };
}
