"use client";
import { useEffect, useState } from "react";

export type PublicConfig = {
  clientPollMs: number;
  tradeEngineMs: number;
  hiddenTabPause: boolean;
  tape: string[];
  rail: string[];
  chartDefaults: {
    tf: string;
    type: string;
    sma: boolean;
    ema: boolean;
    vwap: boolean;
    rsi: boolean;
    compare: boolean;
  };
  marketHours: { open: string; close: string; holidays: string[] };
  banner: string;
  maintenance: boolean;
  providerOff: boolean;
  orderDefaults: { defaultQty: number; confirmOrders: boolean };
  trading: {
    startCash: number;
    maxQty: number;
    maxPositions: number;
    allowShort: boolean;
    haltFills: boolean;
    allowAfterHours: boolean;
    marginPct?: number;
    brokerageFlat: number;
    brokeragePct: number;
    autoSquareOff: boolean;
    squareOffTime: string;
  };
  alertLimits: { maxPerUser: number };
  kyc: {
    /** Minimum total deposits before KYC may be completed. 0 = open to all. */
    minDeposit: number;
  };
};

const FALLBACK: PublicConfig = {
  clientPollMs: 8000,
  tradeEngineMs: 5000,
  hiddenTabPause: true,
  tape: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "RELIANCE",
    "TCS",
    "INFY",
    "SBIN",
    "TATAMOTORS",
    "HDFCBANK",
  ],
  rail: [
    "NIFTY",
    "BANKNIFTY",
    "RELIANCE",
    "TCS",
    "INFY",
    "SBIN",
    "HDFCBANK",
    "TATAMOTORS",
  ],
  chartDefaults: {
    tf: "day",
    type: "candles",
    sma: true,
    ema: false,
    vwap: false,
    rsi: false,
    compare: false,
  },
  marketHours: { open: "09:15", close: "15:30", holidays: [] },
  banner: "",
  maintenance: false,
  providerOff: false,
  orderDefaults: { defaultQty: 1, confirmOrders: true },
  trading: {
    startCash: 100000,
    maxQty: 10000,
    maxPositions: 50,
    allowShort: true,
    haltFills: false,
    allowAfterHours: false,
    marginPct: 5,
    brokerageFlat: 0,
    brokeragePct: 0,
    autoSquareOff: true,
    squareOffTime: "15:15",
  },
  alertLimits: { maxPerUser: 20 },
  kyc: { minDeposit: 25000 },
};

let cached: PublicConfig | null = null;
let fetchedAt = 0;
let inflightFetch: Promise<void> | null = null;
const subs = new Set<() => void>();

// Deduped: dozens of components mount at once on first paint, and without a
// shared promise each one fired its own /api/admin/public request (50+ calls
// in a single page load).
function load(): Promise<void> {
  if (inflightFetch) return inflightFetch;
  inflightFetch = (async () => {
    try {
      const r = await fetch("/api/admin/public", { cache: "no-store" });
      if (r.ok) {
        cached = { ...FALLBACK, ...(await r.json()) };
        fetchedAt = Date.now();
        for (const f of subs) f();
      }
    } catch {
      /* keep fallback */
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

if (typeof window !== "undefined") {
  load();
  setInterval(load, 60000); // refresh admin config every minute
}

export function usePublicConfig(): PublicConfig {
  const [cfg, setCfg] = useState<PublicConfig>(cached ?? FALLBACK);
  useEffect(() => {
    if (!cached || Date.now() - fetchedAt > 30000) load();
    else setCfg(cached);
    const fn = () => cached && setCfg(cached);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return cfg;
}

export function getPublicConfig(): PublicConfig {
  return cached ?? FALLBACK;
}
