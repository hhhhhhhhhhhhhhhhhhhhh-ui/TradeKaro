import { db } from "./db";
import { ledgerKeyFor } from "./authStore";
import { runtimeSettings } from "./adminRuntime";
import { marginPctForEmail } from "./clientRegistry";
import { depositedTotal } from "./deposits";
import { kycGate, normalizeMinDeposit } from "./kycGate";
import { cached } from "./marketCache";
import {
  istInstant,
  istMinutes,
  marketPhase,
  orderWindow,
} from "./marketClock";
import { legKey, normalizeProduct } from "./positionKeys";
import type { AdminSettings } from "./adminStore";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "./upstox";

// ── Authoritative trading engine ────────────────────────────────────────────
// The browser engine (app/lib/trading.ts) stays as an optimistic UI, but it is
// NO LONGER a source of truth. Every fill has to come through POST
// /api/trade/order, where the server:
//
//   1. validates it against a real market price (so invented prices cannot
//      manufacture profit),
//   2. checks it against a derived book rebuilt from its own append-only log
//      (so you cannot sell what you never bought, or spend cash you don't have),
//   3. enforces the admin risk rules server-side.
//
// Scores (realized P&L, win rate, trade count) are recomputed from that log on
// every read, so editing localStorage in devtools changes nothing that counts.

export type InstrumentKind = "STOCK" | "OPTION";
export type FillSide = "BUY" | "SELL";

export type FillInput = {
  symbol: string;
  kind: InstrumentKind;
  side: FillSide;
  qty: number;
  price: number;
  product?: "CNC" | "MIS";
  idem?: string;
  meta?: Record<string, unknown>;
  ts?: number;
};

export type DerivedPos = {
  scrip: string;
  qty: number;
  avg: number;
  side: "LONG" | "SHORT";
  kind?: InstrumentKind;
  product?: "CNC" | "MIS";
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionSide?: "CE" | "PE";
  lotSize?: number;
};

export type TradeAccount = {
  startCash: number;
  cash: number;
  netSpent: number;
  charges: number;
  turnover: number;
  realizedPnl: number;
  fills: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: number;
  positions: DerivedPos[];
  marginPct: number;
  leverage: number;
  grossExposure: number;
  marginUsed: number;
  freeMargin: number;
  /** Money the user has funded. Already included in `startCash`. */
  deposited: number;
};

type FillRow = {
  id: number;
  ts: number;
  symbol: string;
  kind: string;
  side: string;
  qty: number;
  price: number;
  value: number;
  charges: number;
  product: string | null;
  meta: string | null;
  source: string;
  ref_price: number | null;
};

export function accountKey(userId: string) {
  return ledgerKeyFor(userId);
}

// ── Leverage / margin ─────────────────────────────────────────────────────
// The platform trades on margin: cash is a deposit, not the full trade value.
// `marginPct` is the % of trade value that must be held as margin, so 5% means
// up to 20x leverage. Resolved per user (admin can override in Users & KYC),
// falling back to the platform default in Settings → Trading & Risk.
const DEFAULT_MARGIN_PCT = 5;

export async function marginPctFor(email?: string | null): Promise<number> {
  if (email) {
    try {
      const per = await marginPctForEmail(email);
      if (per !== null) return per;
    } catch {
      /* fall through to the platform default */
    }
  }
  try {
    const rs = await runtimeSettings();
    const n = Number(rs.trading?.marginPct);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  } catch {
    /* default below */
  }
  return DEFAULT_MARGIN_PCT;
}

// ── Seeding ────────────────────────────────────────────────────────────────

function getStartCash(key: string): number | null {
  const row = db
    .prepare("SELECT start_cash FROM trade_accounts WHERE user_id = ?")
    .get(key) as { start_cash: number } | undefined;
  return row ? Number(row.start_cash) : null;
}

/**
 * The admin's KYC deposit requirement. 0 = gate off, everyone may complete KYC.
 */
export async function kycRequirement(): Promise<number> {
  try {
    const rs = await runtimeSettings();
    return normalizeMinDeposit(rs.kyc?.minDeposit);
  } catch {
    return 0;
  }
}

/**
 * Capital a user can actually trade with: the seeded virtual cash PLUS every
 * rupee they have deposited. Deposits are a real credit, not a badge — a user
 * who funds ₹25,000 gets ₹25,000 more room, exactly like a broker ledger.
 */
function tradingCapital(key: string): number {
  return (getStartCash(key) ?? 0) + depositedTotal(key);
}

/**
 * Create the account on first use. If the browser had an older book snapshot
 * (the legacy_books snapshot) we import its fills once so existing users keep
 * their history. Imported rows are marked `source = "imported"` and are the
 * LAST thing we ever trust from the client — everything after this must pass
 * validation.
 */
export async function ensureAccount(key: string): Promise<number> {
  const existing = getStartCash(key);
  if (existing !== null) return existing;

  const rs = await runtimeSettings();
  let startCash = Number(rs.trading?.startCash ?? 100000) || 0;

  const legacy = db
    .prepare("SELECT json FROM legacy_books WHERE key = ?")
    .get(key) as { json: string } | undefined;

  let imported = 0;
  if (legacy) {
    try {
      const book = JSON.parse(String(legacy.json)) as {
        trades?: any[];
        funds?: { type: string; amount: number }[];
      };
      const trades = Array.isArray(book.trades) ? book.trades : [];
      const insert = db.prepare(
        `INSERT INTO trade_fills
           (user_id, ts, idem, symbol, kind, side, qty, price, value, charges,
            product, meta, source, ref_price, ref_ts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const t of trades) {
        const qty = Number(t.qty) || 0;
        const price = Number(t.price) || 0;
        const value = Number(t.value) || qty * price;
        if (!t.scrip || !qty || !price || value <= 0) continue;
        insert.run(
          key,
          Number(t.at) || Date.now(),
          null,
          String(t.scrip).toUpperCase(),
          t.kind === "OPTION" ? "OPTION" : "STOCK",
          t.side === "SELL" ? "SELL" : "BUY",
          qty,
          price,
          value,
          Number(t.charges) || 0,
          t.product ?? null,
          JSON.stringify({
            underlying: t.underlying,
            expiry: t.expiry,
            strike: t.strike,
            optionSide: t.optionSide,
            lotSize: t.lotSize,
          }),
          "imported",
          null,
          null,
        );
        imported += 1;
      }
      // Self-service top-ups used to move the wallet. Import them once, capped
      // so an absurd client value cannot mint unlimited capital.
      const fundsNet = (book.funds ?? []).reduce(
        (a, f) =>
          a +
          (f.type === "ADD" ? Number(f.amount) || 0 : -(Number(f.amount) || 0)),
        0,
      );
      if (fundsNet > 0) startCash += Math.min(fundsNet, startCash * 10);
    } catch {
      /* unreadable snapshot — start clean */
    }
  }

  db.prepare(
    "INSERT OR REPLACE INTO trade_accounts (user_id, start_cash, seeded_at) VALUES (?,?,?)",
  ).run(key, startCash, Date.now());
  if (imported) {
    console.log(`[trading] imported ${imported} legacy fills for ${key}`);
  }
  return startCash;
}

// ── Derivation ─────────────────────────────────────────────────────────────

export function fillsFor(key: string): FillRow[] {
  return db
    .prepare(
      "SELECT * FROM trade_fills WHERE user_id = ? ORDER BY ts ASC, id ASC",
    )
    .all(key) as FillRow[];
}

/** Position bookkeeping — mirrors the client's avg-price logic exactly. */
function applyToPositions(list: DerivedPos[], f: FillRow, meta: any) {
  // One row per (scrip, product): a delivery holding and an intraday leg on the
  // same name are different positions, with different lives and different
  // margin. Grouping by scrip alone merged them under a single label.
  const product = normalizeProduct(f.product);
  const i = list.findIndex(
    (p) => p.scrip === f.symbol && normalizeProduct(p.product) === product,
  );
  const qty = Number(f.qty);
  if (i < 0) {
    list.push({
      scrip: f.symbol,
      qty: f.side === "BUY" ? qty : -qty,
      avg: Number(f.price),
      side: f.side === "BUY" ? "LONG" : "SHORT",
      kind: f.kind as InstrumentKind,
      product,
      underlying: meta?.underlying,
      expiry: meta?.expiry,
      strike: meta?.strike,
      optionSide: meta?.optionSide,
      lotSize: meta?.lotSize ?? 1,
    });
    return;
  }
  const p = list[i];
  const newQty = p.qty + (f.side === "BUY" ? qty : -qty);
  if (newQty === 0) {
    list.splice(i, 1);
    return;
  }
  const sameDir = Math.sign(newQty) === Math.sign(p.qty);
  if (!sameDir) {
    // Flipped straight through zero: the remainder opens at this price.
    p.avg = Number(f.price);
  } else if (Math.abs(newQty) > Math.abs(p.qty)) {
    // Only ADDED units move the average — see the matching note in trading.ts.
    // Reducing must leave it alone, otherwise a partial exit inflates it.
    p.avg =
      (Math.abs(p.qty) * p.avg + qty * Number(f.price)) / Math.abs(newQty);
  }
  p.qty = newQty;
  p.side = newQty >= 0 ? "LONG" : "SHORT";
}

/**
 * Rebuild the whole account from the append-only log.
 *
 * Margin model: an open position does not SPEND cash, it BLOCKS margin.
 *   cash (free) = startCash + realized P&L − charges − marginUsed
 * The full notional still shows up as `grossExposure`, which is the number the
 * margin % is applied to. With marginPct = 100 this reduces to paying in full.
 */
export function deriveAccount(key: string, marginPct = 100): TradeAccount {
  const rows = fillsFor(key);
  const deposited = depositedTotal(key);
  const startCash = tradingCapital(key);
  const positions: DerivedPos[] = [];
  let netSpent = 0;
  let charges = 0;
  let turnover = 0;
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  const byScrip = new Map<string, number>();

  for (const f of rows) {
    let meta: any = null;
    try {
      meta = f.meta ? JSON.parse(f.meta) : null;
    } catch {
      meta = null;
    }
    applyToPositions(positions, f, meta);
    const value = Number(f.value);
    netSpent += f.side === "BUY" ? value : -value;
    charges += Number(f.charges) || 0;
    turnover += value;

    // ── realised P&L ──
    // Bank a round-trip the moment the scrip returns to FLAT. The previous
    // version collected net cash per scrip and then skipped every scrip that
    // was still open at the end — so a scrip that was closed and later reopened
    // silently lost the P&L it had already banked. That understated free margin
    // by the same amount, and free margin is what gates order sizing.
    //
    // Net cash for a scrip that is flat equals its true realised P&L, and a flip
    // through zero keeps accumulating here until the scrip does go flat, so the
    // definition is unchanged — only the timing is fixed.
    const net =
      (byScrip.get(f.symbol) || 0) + (f.side === "SELL" ? value : -value);
    // A round-trip is only banked once THAT LEG is flat. Checking the scrip
    // alone would bank early when the same name is still open on the other
    // product, which is exactly the case the split rows make possible.
    if (
      positions.some(
        (p) =>
          p.scrip === f.symbol &&
          normalizeProduct(p.product) === normalizeProduct(f.product),
      )
    ) {
      byScrip.set(f.symbol, net);
    } else {
      realizedPnl += net;
      // A round-trip is the unit, so a scrip closed twice counts twice.
      if (net > 0) wins += 1;
      else if (net < 0) losses += 1;
      byScrip.delete(f.symbol);
    }
  }

  const closed = wins + losses;

  // Exposure at entry price — the server has no per-position live tick, so
  // this is a margin gauge, not a mark-to-market valuation.
  const grossExposure = positions.reduce(
    (sum, p) => sum + Math.abs(p.qty) * p.avg,
    0,
  );
  const marginUsed = (grossExposure * marginPct) / 100;
  const free = startCash + realizedPnl - charges - marginUsed;

  return {
    startCash,
    cash: free,
    netSpent,
    charges,
    turnover,
    realizedPnl,
    fills: rows.length,
    wins,
    losses,
    winRate: closed ? Math.round((wins / closed) * 100) : 0,
    openPositions: positions.length,
    positions,
    marginPct,
    leverage: Math.round((100 / marginPct) * 10) / 10,
    grossExposure,
    marginUsed,
    freeMargin: free,
    deposited,
  };
}

// ── Reference price (the anti-forgery check) ───────────────────────────────

/**
 * The server's own last price for a symbol. A fill is only accepted if the
 * client's price is within tolerance of this, which is what stops a user from
 * buying at 1 and selling at 1000 to fabricate profit.
 */
export async function referencePrice(
  symbol: string,
): Promise<{ price: number; at: number } | null> {
  const rs = await runtimeSettings();
  if (!hasUpstox() || rs.providerOff) return null;
  if (rs.upstoxToken) setRuntimeToken(rs.upstoxToken);
  try {
    const key = await resolveUpstoxKey(symbol);
    const { data } = await cached(
      `refpx:${key}`,
      Math.max(2000, Number(rs.ttl?.quote) || 5000),
      async () => {
        const quotes = await upstoxBatchQuotes([key]);
        const q = quotes.find((x: any) => x?.ltp);
        return q ? { price: Number(q.ltp), at: Date.now() } : null;
      },
    );
    if (data && Number(data.price) > 0) return data as any;
    return null;
  } catch {
    return null;
  }
}

const TOLERANCE = { STOCK: 0.03, OPTION: 0.06 } as const;

/**
 * Why an order was refused. A stable code rather than the human message, so
 * rejections can be counted and charted instead of string-matched — the message
 * text embeds live prices and would never group.
 */
export type RejectReason =
  | "maintenance"
  | "provider_off"
  | "halt_fills"
  | "market_closed"
  | "mis_window_closed"
  | "symbol_missing"
  | "bad_qty"
  | "bad_price"
  | "qty_cap"
  | "no_ref_price"
  | "price_moved"
  | "short_disabled"
  | "position_cap"
  | "insufficient_margin";

export type ValidateResult =
  | { ok: true; refPrice: number | null; charges: number; duplicate?: boolean }
  | {
      ok: false;
      error: string;
      status: number;
      reason: RejectReason;
    };

/**
 * Record a refused order. Deliberately fire-and-forget: analytics must never be
 * able to fail a request, and a rejected order still has to return its error to
 * the client at once.
 */
export function logReject(row: {
  userId: string;
  reason: RejectReason;
  symbol: string;
  kind: string;
  side: string;
  qty?: number;
  price?: number;
  status: number;
  detail?: string;
}) {
  try {
    db.prepare(
      `INSERT INTO trade_rejects
         (at, user_id, reason, symbol, kind, side, qty, price, status, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      Date.now(),
      row.userId,
      row.reason,
      String(row.symbol || ""),
      String(row.kind || ""),
      String(row.side || ""),
      Number.isFinite(Number(row.qty)) ? Number(row.qty) : null,
      Number.isFinite(Number(row.price)) ? Number(row.price) : null,
      row.status,
      row.detail ? String(row.detail).slice(0, 300) : null,
    );
    // Bounded growth: keep three months of reject telemetry.
    db.prepare("DELETE FROM trade_rejects WHERE at < ?").run(
      Date.now() - 90 * 86400_000,
    );
  } catch {
    /* analytics is best-effort — never let it affect the order path */
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

export async function validateFill(
  key: string,
  input: FillInput,
  email?: string | null,
): Promise<ValidateResult> {
  const rs = await runtimeSettings();
  if (rs.maintenance)
    return {
      ok: false,
      error: "Maintenance mode is on",
      status: 503,
      reason: "maintenance",
    };
  if (rs.providerOff)
    return {
      ok: false,
      error: "Trading halted by admin",
      status: 423,
      reason: "provider_off",
    };

  const rules = rs.trading ?? ({} as any);
  if (rules.haltFills)
    return {
      ok: false,
      error: "Fills halted by admin (kill switch)",
      status: 423,
      reason: "halt_fills",
    };

  // The session gate. Placed before every other check because it does not depend
  // on the order at all: outside NSE hours nothing may enter the ledger, however
  // well-formed the request is. Without this, an after-hours order was accepted
  // and marked against the last traded price, booking P&L on a market that was
  // not even open.
  const window = orderWindow(rs.marketHours, rules.allowAfterHours === true);
  if (!window.allowed)
    return {
      ok: false,
      error: window.reason,
      status: 423,
      reason: "market_closed",
    };

  const symbol = String(input.symbol || "").toUpperCase();
  const qty = Number(input.qty);
  const price = Number(input.price);
  if (!symbol)
    return {
      ok: false,
      error: "Symbol required",
      status: 400,
      reason: "symbol_missing",
    };
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1e7)
    return {
      ok: false,
      error: "Invalid quantity",
      status: 400,
      reason: "bad_qty",
    };
  if (!Number.isFinite(price) || price <= 0 || price > 1e8)
    return {
      ok: false,
      error: "Invalid price",
      status: 400,
      reason: "bad_price",
    };
  if (rules.maxQty && qty > Number(rules.maxQty))
    return {
      ok: false,
      error: `Quantity capped at ${rules.maxQty} by risk rules`,
      status: 400,
      reason: "qty_cap",
    };

  const kind: InstrumentKind = input.kind === "OPTION" ? "OPTION" : "STOCK";
  const side: FillSide = input.side === "SELL" ? "SELL" : "BUY";

  // Idempotency: a replayed fill is a no-op SUCCESS — but the caller must not
  // insert it again, hence the duplicate flag.
  if (input.idem) {
    const dupe = db
      .prepare("SELECT id FROM trade_fills WHERE user_id = ? AND idem = ?")
      .get(key, input.idem) as { id: number } | undefined;
    if (dupe) return { ok: true, refPrice: null, charges: 0, duplicate: true };
  }

  // 1. Price must be real.
  const ref = await referencePrice(symbol);
  if (!ref) {
    return {
      ok: false,
      error: "Live price unavailable — cannot verify this order. Try again.",
      status: 409,
      reason: "no_ref_price",
    };
  }
  const dev = Math.abs(price - ref.price) / ref.price;
  if (dev > TOLERANCE[kind]) {
    return {
      ok: false,
      error: `Price moved (₹${price.toFixed(2)} vs live ₹${ref.price.toFixed(2)}) — refresh the ticket`,
      status: 409,
      reason: "price_moved",
    };
  }

  const acct = deriveAccount(key, await marginPctFor(email));
  // Match the SAME leg: a short can be covered by the holding it belongs to, but
  // not by a delivery position on the same name.
  const existing = acct.positions.find(
    (p) => legKey(p.scrip, p.product) === legKey(symbol, input.product),
  );
  const held = existing?.qty ?? 0;

  // 2. Intraday window. Brokers stop accepting NEW intraday legs once the
  //    square-off cutoff has passed — a position opened at 15:14 would only be
  //    flattened a minute later, which is noise for the customer and a phantom
  //    round-trip in their tradebook. Closing an existing MIS leg stays
  //    allowed, so a customer can always get themselves out.
  //
  //    Skipped when the operator has turned off session enforcement
  //    (`trading.allowAfterHours`), since the cutoff only means something while
  //    the session itself is being honoured.
  if (
    input.product === "MIS" &&
    rules.autoSquareOff !== false &&
    rules.allowAfterHours !== true
  ) {
    const increases = side === "BUY" ? held >= 0 : held <= 0;
    const phase = marketPhase(rs.marketHours);
    const pastCutoff =
      istMinutes() >= hhmmToMins(rules.squareOffTime, 15 * 60 + 15);
    if (increases && pastCutoff && (phase === "LIVE" || phase === "POST"))
      return {
        ok: false,
        error:
          `Intraday (MIS) positions are squared off at ` +
          `${rules.squareOffTime || "15:15"} IST — too late to open a new one. ` +
          `Use a delivery (CNC) order instead.`,
        status: 400,
        reason: "mis_window_closed",
      };
  }

  // 2. Shorting / position caps.
  const opensShort = side === "SELL" && held - qty < 0;
  if (opensShort && rules.allowShort === false)
    return {
      ok: false,
      error: "Short selling is disabled by admin",
      status: 400,
      reason: "short_disabled",
    };
  if (
    !existing &&
    rules.maxPositions &&
    acct.positions.length >= Number(rules.maxPositions)
  )
    return {
      ok: false,
      error: `Position limit reached (${rules.maxPositions})`,
      status: 400,
      reason: "position_cap",
    };

  // 3. Cash / holdings, checked against the server's own book.
  //    Margin applies only to the part of the fill that OPENS exposure: buying
  //    back a short or selling a long releases margin instead of consuming it.
  const value = qty * price;
  const charges = chargesFor(value, rules);
  const pct = acct.marginPct;
  const openingUnits =
    side === "BUY"
      ? held < 0
        ? Math.max(0, qty + held) // short cover first, then new long
        : qty
      : held > 0
        ? Math.max(0, qty - held) // long close first, then new short
        : qty;
  const required = (openingUnits * price * pct) / 100 + charges;
  if (required > acct.cash + 0.5) {
    return {
      ok: false,
      error:
        `Insufficient margin: need ₹${required.toFixed(0)} (${pct}% of ` +
        `₹${(openingUnits * price).toFixed(0)}), have ₹${acct.cash.toFixed(0)}`,
      status: 400,
      reason: "insufficient_margin",
    };
  }

  return { ok: true, refPrice: ref.price, charges };
}

function locksShortCash(rules: any) {
  return rules?.allowShort === false;
}

// ── MIS auto square-off (the broker-style risk sweep) ───────────────────────
//
// Real brokers never rely on the customer's browser to flatten intraday
// positions: their risk system closes MIS legs at a fixed cutoff whether or not
// the customer is watching, and regardless of whether a tab is open.
//
// This sweep used to live in the browser (TradeEngine.tsx). That made it
// useless in exactly the case it exists for — a closed tab, or a laptop asleep
// at 15:15 — and a per-day flag in localStorage then stopped it ever being
// retried, so an intraday position could be carried indefinitely.
//
// It now lives here, next to the ledger, and is:
//   * cutoff-timed rather than close-timed, so it runs while the market is still
//     open (which is also what lets it pass the market-hours gate);
//   * idempotent — positions are re-derived from the fills log every pass, so a
//     leg already flattened simply is not there next time;
//   * self-starting — any account read triggers it, and it then keeps its own
//     timer so it still fires during a quiet afternoon with no traffic.

const SWEEP_THROTTLE_MS = 60_000;

function hhmmToMins(hhmm: string | undefined, fb: number) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : fb;
}

/**
 * Is the sweep due, and what timestamp should its fill carry?
 *
 * The cutoff is bought forward from the admin panel (`trading.squareOffTime`,
 * default 15:15) and must land inside the session so the closing order can
 * actually be priced. When the process was not running at the cutoff we still
 * close the leg, but stamp it at the moment the session ended — never at "now" —
 * so a late sweep cannot masquerade as an after-hours trade in the tradebook.
 */
export function squareOffDue(
  rs: AdminSettings,
  now = new Date(),
): { due: boolean; stamp: number; why: string } {
  if (rs.trading?.autoSquareOff === false)
    return { due: false, stamp: 0, why: "auto square-off is off" };
  const phase = marketPhase(rs.marketHours, now);
  if (phase === "WEEKEND" || phase === "HOLIDAY")
    return { due: false, stamp: 0, why: `no session (${phase})` };
  const cutoffMs = istInstant(now, rs.trading?.squareOffTime || "15:15");
  if (now.getTime() < cutoffMs)
    return { due: false, stamp: 0, why: "before the cutoff" };
  const closeMs = istInstant(now, rs.marketHours?.close || "15:30");
  return {
    due: true,
    stamp: Math.min(now.getTime(), closeMs),
    why: phase === "LIVE" ? "cutoff reached" : "cutoff missed — catching up",
  };
}

/** One open intraday leg. */
type MisLeg = {
  symbol: string;
  qty: number;
  kind: InstrumentKind;
  meta: Record<string, unknown>;
};

/**
 * Open intraday exposure for one user.
 *
 * Positions are one row per (scrip, product) — see `applyToPositions` — so an
 * intraday leg and a delivery holding on the same name no longer collapse into a
 * single row. That is what makes this filter safe: it returns the MIS quantity
 * on its own, and long 5 MIS + long 10 CNC closes 5, not 15.
 */
function misLegs(key: string): MisLeg[] {
  return deriveAccount(key)
    .positions.filter((p) => p.product === "MIS" && p.qty !== 0)
    .map((p) => ({
      symbol: p.scrip,
      qty: p.qty,
      kind: p.kind ?? "STOCK",
      meta: {
        underlying: p.underlying,
        expiry: p.expiry,
        strike: p.strike,
        optionSide: p.optionSide,
        lotSize: p.lotSize,
      },
    }));
}

/**
 * Flatten every open intraday leg. Safe to call at any frequency: it derives
 * what is actually open rather than trusting a flag, so the only way it touches
 * a position is if one is genuinely still open.
 */
export async function sweepMisSquareOff(
  now = new Date(),
): Promise<{ swept: number; unpriced: number; why: string }> {
  const rs = await runtimeSettings();
  const plan = squareOffDue(rs, now);
  if (!plan.due) return { swept: 0, unpriced: 0, why: plan.why };
  // A maintenance freeze stops user trading; the sweep waits with it rather than
  // reaching for prices while the operator has the system held.
  if (rs.maintenance) return { swept: 0, unpriced: 0, why: "maintenance mode" };

  const users = db
    .prepare("SELECT DISTINCT user_id FROM trade_fills")
    .all() as { user_id: string }[];

  let swept = 0;
  let unpriced = 0;

  for (const u of users) {
    // Take the symbols first, then re-check each one individually: the price
    // fetch below is an await, and the customer can trade during it.
    for (const symbol of misLegs(u.user_id).map((l) => l.symbol)) {
      const ref = await referencePrice(symbol).catch(() => null);
      // No price, no exit. A silent bad fill would be worse than a stale
      // position; the next pass retries.
      if (!ref) {
        unpriced += 1;
        continue;
      }

      // Re-read AFTER the await. Closing the size we saw before it would be
      // wrong if the customer flattened or resized the leg in between — a stale
      // close is not a no-op, it opens a position in the opposite direction.
      // There is no await between this read and `commitFill`, so the two are
      // atomic with respect to any other request on this process.
      const leg = misLegs(u.user_id).find((l) => l.symbol === symbol);
      if (!leg) continue;

      const qty = Math.abs(leg.qty);
      commitFill(
        u.user_id,
        {
          symbol,
          kind: leg.kind,
          side: leg.qty > 0 ? "SELL" : "BUY",
          qty,
          price: ref.price,
          product: "MIS",
          // Keyed on how many fills this symbol already has. A timestamp-only key
          // was a bug: outside session hours `plan.stamp` pins to the session
          // close, so the key repeated all evening — a leg squared off at 15:15
          // and reopened later was silently swallowed by INSERT OR IGNORE and
          // never closed, while still being counted as swept. A new leg adds a
          // fill, so it gets a fresh key; two sweepers that read the same count
          // still collide and only one insert lands.
          idem: `sqoff:${u.user_id}:${symbol}:${fillCount(u.user_id, symbol)}`,
          ts: plan.stamp,
          meta: leg.meta,
        },
        ref.price,
        chargesFor(qty * ref.price, rs.trading),
        "squareoff",
      );
      swept += 1;
    }
  }

  if (swept || unpriced)
    console.log(
      `[mis] auto square-off: ${swept} leg(s) closed` +
        (unpriced ? `, ${unpriced} could not be priced` : "") +
        ` — ${plan.why}`,
    );
  return { swept, unpriced, why: plan.why };
}

/** How many fills exist for one user+symbol — used to key the sweep's idempotency. */
function fillCount(key: string, symbol: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM trade_fills WHERE user_id = ? AND symbol = ?",
    )
    .get(key, symbol) as { c: number } | undefined;
  return Number(row?.c || 0);
}

const G = globalThis as unknown as {
  __tkMisSweep?: ReturnType<typeof setInterval>;
};
let sweeping = false;
/** Set only when a sweep actually ran (i.e. was due), never on a no-op check. */
let lastDueSweepAt = 0;

/**
 * Run a sweep if one is due. The "due" test is cheap and happens first, so the
 * throttle in `maybeSquareOffMis` only ever limits real work — a sweep that has
 * just become due is never delayed by a previous no-op check.
 */
async function runSweepIfDue(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const rs = await runtimeSettings();
    if (!squareOffDue(rs).due) return;
    lastDueSweepAt = Date.now();
    await sweepMisSquareOff();
  } catch {
    /* the sweep must never take down whatever called it */
  } finally {
    sweeping = false;
  }
}

/** Start the background timer once per process. */
function ensureSweepTimer() {
  if (typeof window !== "undefined" || G.__tkMisSweep) return;
  G.__tkMisSweep = setInterval(() => void runSweepIfDue(), SWEEP_THROTTLE_MS);
  // Do not hold the process open on shutdown.
  (G.__tkMisSweep as unknown as { unref?: () => void }).unref?.();
}

/**
 * Cheap hook for the read paths: guarantees the timer is alive and runs a sweep
 * if one is due, at most once a minute. Called from `publicAccount`, so merely
 * opening a page is enough to bring the risk system up — which is the point,
 * because the browser is no longer responsible for the square-off.
 */
export async function maybeSquareOffMis(): Promise<void> {
  ensureSweepTimer();
  if (sweeping || Date.now() - lastDueSweepAt < SWEEP_THROTTLE_MS) return;
  await runSweepIfDue();
}

export function chargesFor(value: number, rules: any): number {
  const flat = Number(rules?.brokerageFlat ?? 0) || 0;
  const pct = Number(rules?.brokeragePct ?? 0) || 0;
  return flat + (value * pct) / 100;
}

/** Append a validated fill. Only reachable from validate-then-commit flow. */
export function commitFill(
  key: string,
  input: FillInput,
  refPrice: number | null,
  charges: number,
  /**
   * Provenance of the row. `live` for anything a user placed; `squareoff` for a
   * leg the risk sweep flattened. Kept as a column so the tradebook can explain
   * a close the customer never clicked.
   */
  source = "live",
): { ts: number } {
  const symbol = String(input.symbol).toUpperCase();
  const qty = Number(input.qty);
  const price = Number(input.price);
  const ts = Number(input.ts) || Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO trade_fills
       (user_id, ts, idem, symbol, kind, side, qty, price, value, charges,
        product, meta, source, ref_price, ref_ts)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    key,
    ts,
    input.idem ?? null,
    symbol,
    input.kind === "OPTION" ? "OPTION" : "STOCK",
    input.side === "SELL" ? "SELL" : "BUY",
    qty,
    price,
    qty * price,
    charges,
    input.product ?? null,
    JSON.stringify(input.meta ?? {}),
    source,
    refPrice,
    refPrice === null ? null : Date.now(),
  );
  return { ts };
}

/** Public shape for the client (no raw rows, no user ids). */
export async function publicAccount(key: string, email?: string | null) {
  // Bring the risk sweep up before reporting positions, so the book the customer
  // is shown is the one the ledger will agree with a moment later. Throttled
  // internally, so the common case is a single timestamp comparison.
  await maybeSquareOffMis();
  const pct = await marginPctFor(email);
  const a = deriveAccount(key, pct);
  // The KYC gate is computed server-side for the same reason the ledger is: a
  // browser that could decide it is eligible is not a gate at all.
  const gate = kycGate(a.deposited, await kycRequirement());
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    startCash: r2(a.startCash),
    cash: r2(a.cash),
    netSpent: r2(a.netSpent),
    charges: r2(a.charges),
    turnover: r2(a.turnover),
    realizedPnl: r2(a.realizedPnl),
    fills: a.fills,
    wins: a.wins,
    losses: a.losses,
    winRate: a.winRate,
    openPositions: a.openPositions,
    positions: a.positions,
    marginPct: a.marginPct,
    leverage: a.leverage,
    grossExposure: r2(a.grossExposure),
    marginUsed: r2(a.marginUsed),
    freeMargin: r2(a.freeMargin),
    deposited: r2(a.deposited),
    kycMinDeposit: gate.required,
    kycEligible: gate.eligible,
    kycRemaining: r2(gate.remaining),
  };
}
