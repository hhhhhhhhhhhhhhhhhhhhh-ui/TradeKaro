"use client";
import { useEffect, useState } from "react";
import type { ExchangeCode } from "@/app/lib/marketClock";

/**
 * What a symbol actually is, from the instrument master.
 *
 * The ticket cannot derive any of this from the symbol's name. It needs the lot
 * size (a quantity that is not a multiple of the lot is rejected), the tick size
 * (so the stepper moves in valid increments) and the segment (MCX trades until
 * 23:30, the cash market until 15:30 — the button state has to match the
 * server's, or the customer is invited to place an order that gets refused).
 */
export type InstrumentMeta = {
  symbol: string;
  key: string | null;
  segment: ExchangeCode;
  segmentLabel: string;
  isCommodity: boolean;
  contract: { lot: number; tick: number; expiry: string; name: string } | null;
};

/**
 * Module-level cache, keyed by symbol.
 *
 * Several components ask about the same symbol on one page (the ticket, the
 * order book, the header), and the answer is exchange reference data that
 * changes at most daily. Re-fetching it per component would be three identical
 * requests per render pass.
 */
const cache = new Map<string, InstrumentMeta>();
const inflight = new Map<string, Promise<void>>();

// Relative on purpose: the app is served from the same origin, and an absolute
// URL here would break behind the Cloudflare proxy. Market routes live under
// `/api/market`, not under the `/api/v1` account namespace.
const PATH = "/api/market/instrument";

async function load(symbols: string[]): Promise<void> {
  const missing = symbols.filter((s) => !cache.has(s) && !inflight.has(s));
  if (!missing.length) {
    await Promise.all(symbols.map((s) => inflight.get(s)));
    return;
  }
  const p = (async () => {
    const r = await fetch(
      `${PATH}?symbols=${encodeURIComponent(missing.join(","))}`,
      { cache: "force-cache" },
    );
    if (!r.ok) throw new Error(`instrument ${r.status}`);
    const j = await r.json();
    for (const it of (j.items || []) as InstrumentMeta[]) {
      if (it?.symbol) cache.set(it.symbol, it);
    }
  })();
  for (const s of missing) inflight.set(s, p);
  try {
    await p;
  } finally {
    for (const s of missing) inflight.delete(s);
  }
}

/**
 * Instrument metadata already in memory, or null.
 *
 * Sync, for callers that cannot await: the fill engine has to decide which
 * exchange's session to check BEFORE it books an optimistic fill.
 */
export function cachedInstrument(symbol: string): InstrumentMeta | null {
  return cache.get(String(symbol || "").toUpperCase()) ?? null;
}

/**
 * Metadata for a symbol, fetching it if it is not already known.
 *
 * For non-React callers — the pending-order engine and the basket executor run
 * outside a component, so they cannot call the hook but still need the segment.
 * Returns null rather than throwing; the caller falls back to NSE and the server
 * gate remains the authority.
 */
export async function ensureInstrument(
  symbol: string,
): Promise<InstrumentMeta | null> {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return null;
  if (!cache.has(sym)) await load([sym]).catch(() => {});
  return cache.get(sym) ?? null;
}

/**
 * Instrument metadata for one symbol.
 *
 * `ready` is deliberately exposed: callers must not apply lot arithmetic before
 * it is true, because a missing contract would read as "lot size 1" and quietly
 * turn one lot of silver into one unit.
 */
export function useInstrument(symbol: string): {
  meta: InstrumentMeta | null;
  ready: boolean;
} {
  const sym = String(symbol || "").toUpperCase();
  const [meta, setMeta] = useState<InstrumentMeta | null>(
    () => cache.get(sym) ?? null,
  );

  useEffect(() => {
    if (!sym || cache.has(sym)) {
      setMeta(cache.get(sym) ?? null);
      return;
    }
    let alive = true;
    load([sym])
      .then(() => {
        if (alive) setMeta(cache.get(sym) ?? null);
      })
      .catch(() => {
        // Unknown is fine: the ticket falls back to share semantics and the
        // server gate still enforces the real lot size.
        if (alive) setMeta(null);
      });
    return () => {
      alive = false;
    };
  }, [sym]);

  return { meta, ready: Boolean(meta?.key) || Boolean(sym && cache.has(sym)) };
}

/** Lot size for the symbol's commodity contract, or 1 for everything else. */
export function lotOf(meta: InstrumentMeta | null): number {
  const lot = Number(meta?.contract?.lot);
  return Number.isFinite(lot) && lot > 0 ? Math.round(lot) : 1;
}
