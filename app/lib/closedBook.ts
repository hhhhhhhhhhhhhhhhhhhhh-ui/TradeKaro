"use client";
// Derived views over the immutable ledger.
//
// `fs_tradebook` only stores individual fills. The Positions screen also needs
// *closed round-trips* (a scrip that is flat again) and a *today* slice. Both
// are derived here using the same average-cost method `applyPaperFill` uses for
// the live book, so the closed figures always reconcile with the open ones
// instead of being a second, divergent calculation.

import {
  getTrades,
  type InstrumentKind,
  type TradeEntry,
} from "@/app/lib/trading";
import { legKey } from "@/app/lib/positionKeys";

export type ClosedPosition = {
  /** Stable React key — a scrip can complete several round-trips. */
  key: string;
  scrip: string;
  kind: InstrumentKind;
  /** Units matched out: the size of the completed round-trip. */
  qty: number;
  /** Volume-weighted price paid to get in. */
  avgEntry: number;
  /** Volume-weighted price received getting out. */
  avgExit: number;
  /** Gross realised P&L, before brokerage. */
  grossPnl: number;
  /** Brokerage booked against this round-trip. */
  charges: number;
  /** Gross − charges: what actually reached the wallet. */
  netPnl: number;
  openedAt: number;
  closedAt: number;
  fills: number;
  side: "LONG" | "SHORT";
  product?: "CNC" | "MIS";
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionSide?: "CE" | "PE";
};

export type DayBook = {
  /** Today's fills, oldest first. */
  fills: TradeEntry[];
  count: number;
  buyValue: number;
  sellValue: number;
  turnover: number;
  charges: number;
  /** Gross realised by today's closing fills. */
  realized: number;
  /** Realised − today's brokerage. */
  net: number;
};

export const EMPTY_DAY: DayBook = {
  fills: [],
  count: 0,
  buyValue: 0,
  sellValue: 0,
  turnover: 0,
  charges: 0,
  realized: 0,
  net: 0,
};

/** India is a fixed +5:30 with no DST, so this never needs a timezone library. */
const IST_MS = 5.5 * 3600 * 1000;

/** Round to paise — average-cost maths leaves dust behind (−1e-13, not 0). */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Epoch ms of the most recent 00:00 IST. */
export function istDayStart(now = Date.now()): number {
  const ist = new Date(now + IST_MS);
  return (
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS
  );
}

type Replay = {
  trips: ClosedPosition[];
  /** Gross realised by closing fills at or after `since`. */
  realizedSince: number;
  /** The leg that never went flat (null when the scrip is square). */
  open: { qty: number; avg: number; since: number } | null;
};

/**
 * Replay one scrip's fills in time order with average-cost accounting.
 *
 * A round-trip closes the moment the running position returns to zero *or*
 * flips straight through it — both are recorded, and a flip opens the next
 * round-trip with the remainder. A partially-closed position that is still
 * open is deliberately NOT reported here: it is not closed, and its realised
 * slice is already inside the account's realised total.
 */
function replayScrip(
  scrip: string,
  fills: TradeEntry[],
  since: number,
): Replay {
  const trips: ClosedPosition[] = [];
  let q = 0; // signed units
  let avg = 0; // average price of the open units
  let entryUnits = 0;
  let entryNotional = 0;
  let exitUnits = 0;
  let exitNotional = 0;
  let gross = 0;
  let charges = 0;
  let openedAt = 0;
  let closedAt = 0;
  let legFills = 0;
  let side: "LONG" | "SHORT" = "LONG";
  let meta: Partial<ClosedPosition> = {};
  let realizedSince = 0;
  let seq = 0;

  const metaOf = (f: TradeEntry): Partial<ClosedPosition> => ({
    kind: f.kind,
    product: f.product,
    underlying: f.underlying,
    expiry: f.expiry,
    strike: f.strike,
    optionSide: f.optionSide,
  });

  // Push the completed leg and clear every accumulator. `charges` is spent by
  // the leg it closes, so on a flip the remainder leg legitimately starts at 0.
  const close = () => {
    if (exitUnits > 0) {
      const grossR = r2(gross);
      const chargesR = r2(charges);
      trips.push({
        key: `${scrip}#${seq++}#${closedAt}`,
        scrip,
        kind: meta.kind ?? "STOCK",
        qty: exitUnits,
        avgEntry: entryUnits ? r2(entryNotional / entryUnits) : avg,
        avgExit: r2(exitNotional / exitUnits),
        grossPnl: grossR,
        charges: chargesR,
        netPnl: r2(grossR - chargesR),
        openedAt,
        closedAt,
        fills: legFills,
        side,
        product: meta.product,
        underlying: meta.underlying,
        expiry: meta.expiry,
        strike: meta.strike,
        optionSide: meta.optionSide,
      });
    }
    entryUnits = 0;
    entryNotional = 0;
    exitUnits = 0;
    exitNotional = 0;
    gross = 0;
    charges = 0;
    openedAt = 0;
    legFills = 0;
    meta = {};
  };

  for (const f of fills) {
    const n = Math.abs(f.qty);
    if (!n) continue;
    const delta = f.side === "BUY" ? n : -n;

    if (legFills === 0) {
      openedAt = f.at;
      meta = metaOf(f);
    } else {
      // Keep the freshest leg metadata — an option's expiry can be rolled.
      meta = { ...meta, ...metaOf(f) };
    }
    legFills++;
    closedAt = f.at;
    charges += f.charges ?? 0;

    if (q === 0) {
      // Fresh leg.
      q = delta;
      avg = f.price;
      side = delta > 0 ? "LONG" : "SHORT";
      entryUnits += n;
      entryNotional += n * f.price;
      continue;
    }

    if (Math.sign(delta) === Math.sign(q)) {
      // Same direction: blend the average.
      avg = (Math.abs(q) * avg + n * f.price) / (Math.abs(q) + n);
      q += delta;
      entryUnits += n;
      entryNotional += n * f.price;
      continue;
    }

    // Opposite direction: realise on the matched units.
    const dir = Math.sign(q);
    const matched = Math.min(n, Math.abs(q));
    const g = (f.price - avg) * matched * dir;
    gross += g;
    if (f.at >= since) realizedSince += g;
    exitUnits += matched;
    exitNotional += matched * f.price;
    const rest = n - matched;
    q += delta;

    if (q === 0) {
      close();
    } else if (Math.sign(q) !== dir) {
      // Flipped straight through zero: this fill ends one round-trip and opens
      // the next on the other side.
      close();
      avg = f.price;
      side = q > 0 ? "LONG" : "SHORT";
      openedAt = f.at;
      entryUnits = rest;
      entryNotional = rest * f.price;
      legFills = 1;
      meta = metaOf(f);
    }
    // Partial close with the sign intact: q and avg are already correct.
  }

  return {
    trips,
    realizedSince: r2(realizedSince),
    open: q === 0 ? null : { qty: q, avg, since: openedAt },
  };
}

/**
 * Group the tradebook by position leg — one (scrip, product) pair per group,
 * oldest fill first.
 *
 * Grouping by scrip alone used to net a delivery buy against an intraday sell on
 * the same name and report it as one round-trip, which is not a round-trip at
 * all: those are two positions with separate lives and separate P&L.
 */
function byLeg(all: TradeEntry[]): Map<string, TradeEntry[]> {
  const m = new Map<string, TradeEntry[]>();
  for (const t of all) {
    const k = legKey(t.scrip, t.product);
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  }
  for (const list of m.values()) list.sort((a, b) => a.at - b.at);
  return m;
}

/** Every completed round-trip in the tradebook, most recently closed first. */
export function getClosedPositions(): ClosedPosition[] {
  if (typeof window === "undefined") return [];
  const out: ClosedPosition[] = [];
  for (const [, fills] of byLeg(getTrades()))
    out.push(...replayScrip(fills[0]?.scrip ?? "", fills, 0).trips);
  return out.sort((a, b) => b.closedAt - a.closedAt);
}

/**
 * Leg key (`scrip\u0000product`) → epoch ms the current, still-open leg started.
 * Keyed by leg rather than scrip so a delivery holding and an intraday leg on the
 * same name report their own ages.
 */
export function getOpenSince(): Record<string, number> {
  if (typeof window === "undefined") return {};
  const out: Record<string, number> = {};
  for (const [leg, fills] of byLeg(getTrades())) {
    const r = replayScrip(fills[0]?.scrip ?? "", fills, 0);
    if (r.open) out[leg] = r.open.since;
  }
  return out;
}

/** Today's (IST) fills plus the day's turnover, charges and realised P&L. */
export function getDayBook(now = Date.now()): DayBook {
  if (typeof window === "undefined") return EMPTY_DAY;
  const since = istDayStart(now);
  const groups = byLeg(getTrades());
  const fills: TradeEntry[] = [];
  let realized = 0;
  for (const [, list] of groups) {
    // Replay from the very first fill so the average-cost state behind today's
    // closing fills is correct, but only bank the P&L earned today.
    realized += replayScrip("", list, since).realizedSince;
    for (const t of list) if (t.at >= since) fills.push(t);
  }
  fills.sort((a, b) => a.at - b.at);
  let buyValue = 0;
  let sellValue = 0;
  let charges = 0;
  for (const t of fills) {
    if (t.side === "BUY") buyValue += t.value;
    else sellValue += t.value;
    charges += t.charges ?? 0;
  }
  return {
    fills,
    count: fills.length,
    buyValue,
    sellValue,
    turnover: buyValue + sellValue,
    charges,
    realized,
    net: r2(realized - charges),
  };
}
