"use client";
import { useEffect, useState } from "react";

/**
 * The commodity roots, for symbol search.
 *
 * Search across this app reads `app/components/symbols.tsx`, which is a static
 * NSE equity/ETF list. That list has no MCX contract in it, so typing GOLD
 * offered GOLDENTOBC, GOLDSTAR and GOLDIAM, and typing CRUDEOIL offered nothing
 * at all — the contracts existed but were unreachable except through
 * /commodities. Merging the master's roots in is what makes them findable.
 *
 * Loaded once per session and shared: three separate search surfaces ask for it,
 * and the answer is exchange reference data that changes at most daily.
 */
export type UniverseItem = {
  symbol: string;
  /** Exchange code, e.g. "MCX". */
  segment: string;
  /** Friendly name, e.g. "MCX". */
  segmentLabel: string;
  /** Quoted units per lot. */
  lot: number;
  expiry: string;
};

let cache: UniverseItem[] | null = null;
let inflight: Promise<UniverseItem[]> | null = null;

async function fetchUniverse(): Promise<UniverseItem[]> {
  const r = await fetch("/api/market/instrument?all=commodities");
  if (!r.ok) throw new Error(`instrument ${r.status}`);
  const j = await r.json();
  return ((j.items || []) as any[])
    .filter((i) => i?.symbol && i?.contract)
    .map((i) => ({
      symbol: String(i.symbol).toUpperCase(),
      segment: String(i.segment || "MCX"),
      segmentLabel: String(i.segmentLabel || i.segment || "MCX"),
      lot: Number(i.contract?.lot) || 1,
      expiry: String(i.contract?.expiry || ""),
    }));
}

/** All commodity roots. Empty until the first fetch resolves, and on failure. */
export function useCommodities(): UniverseItem[] {
  const [items, setItems] = useState<UniverseItem[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    inflight ??= fetchUniverse().then(
      (r) => {
        cache = r;
        return r;
      },
      (e) => {
        inflight = null; // let a later mount retry
        throw e;
      },
    );
    inflight.then(
      (r) => {
        if (alive) setItems(r);
      },
      () => {
        /* search degrades to the equity list, which is the old behaviour */
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return items;
}

/** One-line label for a commodity hit, e.g. "MCX · lot 100 · exp 05 Oct 2026". */
export function commoditySubtitle(i: UniverseItem): string {
  const bits = [i.segmentLabel, `lot ${i.lot}`];
  if (i.expiry) {
    const d = new Date(`${i.expiry}T00:00:00Z`);
    bits.push(
      Number.isFinite(d.getTime())
        ? `exp ${d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}`
        : `exp ${i.expiry}`,
    );
  }
  return bits.join(" · ");
}

/** Short tag for a book row. Options say OPT, commodities say MCX, cash says EQ. */
const SHORT_VENUE: Record<string, string> = {
  NSE: "EQ",
  BSE: "BSE",
  NFO: "OPT",
  BFO: "OPT",
  MCX: "MCX",
  NSCOM: "MCX",
  CDS: "CDS",
  BCD: "CDS",
};

/**
 * Which market a book row belongs to, as a short tag.
 *
 * Every one of these rows used to be hardcoded "EQ", because a position carried
 * no exchange at all. New fills record it, but rows booked before that do not,
 * so the commodity list doubles as the fallback — it is already loaded by the
 * search surfaces, and it means historical commodity legs label correctly
 * instead of staying wrong until they are closed.
 */
export function venueTag(
  p: { scrip?: string; kind?: string; exchange?: string },
  commodities: UniverseItem[],
): string {
  if (p.kind === "OPTION") return "OPT";
  if (p.exchange) return SHORT_VENUE[p.exchange] ?? p.exchange;
  const scrip = String(p.scrip || "").toUpperCase();
  if (scrip && commodities.some((c) => c.symbol === scrip)) return "MCX";
  return "EQ";
}
