"use client";
// Single source of truth for the client side of trading (stocks + options).
// The SERVER owns the ledger (app/lib/tradingServer.ts); this module is the
// optimistic UI mirror plus the client-side pre-checks that give instant
// feedback. Cash model on the server: startCash − netSpent − charges.

import { useEffect, useState } from "react";
import { getPublicConfig, usePublicConfig } from "@/app/hooks/usePublicConfig";
import { kycGate, type KycGate } from "./kycGate";
import { legKey, normalizeProduct } from "./positionKeys";
import { orderWindow, EQUITY_EXCHANGE, type ExchangeCode } from "./marketClock";
import { cachedInstrument } from "@/app/hooks/useInstrument";

export type InstrumentKind = "STOCK" | "OPTION";
export type FillSide = "BUY" | "SELL";

export type TradeEntry = {
  id: string;
  scrip: string;
  side: FillSide;
  qty: number; // total units (shares, or lots × lotSize for options)
  price: number; // per-unit premium / share price
  value: number; // qty × price
  at: number;
  kind: InstrumentKind;
  charges?: number; // brokerage applied at fill time
  product?: "CNC" | "MIS";
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionSide?: "CE" | "PE";
  lotSize?: number;
};

export type TradePos = {
  scrip: string;
  qty: number; // signed total units (+LONG / −SHORT)
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

const POS_KEY = "fs_positions";
const TRADE_KEY = "fs_tradebook";
const FUNDS_KEY = "fs_funds";
const CASH_KEY = "fs_backend_cash";
// Marks that `fs_backend_cash` holds a server-derived balance rather than the
// public "start cash" fallback. The two cannot be told apart by value alone,
// and the local wallet formula must not run on the server's already-netted one.
const CASH_SERVER_KEY = "fs_backend_cash_srv";

// Last seen backend remainingCash, cached by portfolio so options page
// can enforce the same wallet without an extra authed fetch.
// Before the first authed fetch lands (fresh browser, cleared storage) the
// cache is empty — fall back to the admin-configured starting cash so a
// brand-new visitor is not blocked with a ₹0 wallet.
export function getBackendCash(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(CASH_KEY);
  if (raw === null || raw === "") {
    const start = Number(getPublicConfig().trading?.startCash ?? 0);
    return Number.isFinite(start) ? start : 0;
  }
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0;
}

export function setBackendCash(v: number) {
  try {
    localStorage.setItem(CASH_KEY, String(v || 0));
    localStorage.setItem(CASH_SERVER_KEY, "1");
  } catch {
    /* noop */
  }
}

/** True once a balance has arrived from the server this browser. */
function hasServerCash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CASH_SERVER_KEY) === "1";
  } catch {
    return false;
  }
}

function read<T>(key: string, fb: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fb;
  } catch {
    return fb;
  }
}

// Cross-tab + same-tab sync: every paper mutation notifies listeners
// (useLivePnl, PositionsPanel, tickets) so wallet/P&L move instantly.
// Also schedules a debounced push to the server mirror (per auth token).
export function notifyLedger() {
  try {
    window.dispatchEvent(new Event("fs-ledger"));
  } catch {
    /* noop */
  }
  scheduleLedgerSync();
}

// ── Server ledger (authoritative) ─────────────────────────────────────────
// localStorage is only an optimistic UI mirror. The server owns the ledger:
// every fill must pass validation in POST /api/trade/order, and every score
// below comes from the server's derived account, so editing localStorage can
// no longer inflate anything that counts.

export type ServerAccount = {
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
  positions: TradePos[];
  // Leverage / margin (server-resolved, per user)
  marginPct: number;
  leverage: number;
  grossExposure: number;
  marginUsed: number;
  freeMargin: number;
  // Deposits (server ledger) + the KYC gate they unlock.
  deposited: number;
  kycMinDeposit: number;
  kycEligible: boolean;
  kycRemaining: number;
};

let serverAccount: ServerAccount | null = null;
const accountSubs = new Set<() => void>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function getServerAccount(): ServerAccount | null {
  return serverAccount;
}

export function subscribeTradingAccount(fn: () => void) {
  accountSubs.add(fn);
  return () => {
    accountSubs.delete(fn);
  };
}

function setServerAccount(a: ServerAccount | null) {
  serverAccount = a;
  for (const f of accountSubs) f();
}

function authToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(/(?:^|;\s*)token=([^;]+)/)?.[1];
}

function authHeaders(): HeadersInit {
  const token = authToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
}

/** Replace the local mirror with the server's book — the server always wins. */
function adoptServerBook(book: any) {
  if (!book) return;
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(book.positions ?? []));
    localStorage.setItem(TRADE_KEY, JSON.stringify(book.trades ?? []));
  } catch {
    /* quota — the server copy still stands */
  }
}

/** Pull the authoritative book + account. Also the rollback path. */
export async function refreshLedger(): Promise<ServerAccount | null> {
  if (typeof window === "undefined" || !authToken()) return null;
  try {
    const r = await fetch("/api/trade", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action: "load" }),
    });
    if (!r.ok) return null;
    const { book, account } = await r.json();
    adoptServerBook(book);
    setServerAccount(account ?? null);
    window.dispatchEvent(new Event("fs-ledger"));
    return account ?? null;
  } catch {
    return null;
  }
}

// Debounced resync after a local mutation (never pushes local state up).
export function scheduleLedgerSync() {
  if (typeof window === "undefined") return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void refreshLedger(), 1500);
}

/**
 * Send an optimistic local fill to the server for validation. If it is refused
 * (price moved, or a book that does not add up) the local mirror snaps back to
 * server truth and "fs-ledger-rejected" fires for the toast layer — so a
 * tampered client cannot keep a trade, and the UI corrects itself visibly.
 */
export async function submitFill(args: {
  entry: TradeEntry;
  kind: InstrumentKind;
  product?: "CNC" | "MIS";
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionSide?: "CE" | "PE";
  lotSize?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const e = args.entry;
  if (typeof window === "undefined" || !authToken()) return { ok: true };
  try {
    const r = await fetch("/api/trade/order", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        symbol: e.scrip,
        kind: args.kind,
        side: e.side,
        qty: e.qty,
        price: e.price,
        product: args.product,
        underlying: args.underlying,
        expiry: args.expiry,
        strike: args.strike,
        optionSide: args.optionSide,
        lotSize: args.lotSize,
        ts: e.at,
        idem: e.id,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j?.account) setServerAccount(j.account);
      const error = String(j?.error || "Order rejected by the server");
      try {
        window.dispatchEvent(
          new CustomEvent("fs-ledger-rejected", { detail: error }),
        );
      } catch {
        /* noop */
      }
      await refreshLedger();
      return { ok: false, error };
    }
    if (j?.account) setServerAccount(j.account);
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error — order was not recorded" };
  }
}

// On boot: adopt server truth. Local state is never pushed up.
export async function initLedgerSync() {
  await refreshLedger();
}

/** Subscribe a component to the authoritative account. */
export function useTradingAccount(): ServerAccount | null {
  const [acct, setAcct] = useState<ServerAccount | null>(serverAccount);
  useEffect(() => {
    setAcct(serverAccount);
    return subscribeTradingAccount(() => setAcct(serverAccount));
  }, []);
  return acct;
}

export function getPositions(): TradePos[] {
  if (typeof window === "undefined") return [];
  return read<TradePos[]>(POS_KEY, []);
}

// Positions tagged MIS — auto squared off at the daily cutoff.
export function misPositions(): TradePos[] {
  return getPositions().filter((p) => p.product === "MIS");
}

function savePositions(p: TradePos[]) {
  localStorage.setItem(POS_KEY, JSON.stringify(p));
  notifyLedger();
}

export function getTrades(): TradeEntry[] {
  if (typeof window === "undefined") return [];
  return read<TradeEntry[]>(TRADE_KEY, []);
}

function saveTrades(t: TradeEntry[]) {
  localStorage.setItem(TRADE_KEY, JSON.stringify(t));
  notifyLedger();
}

export function getFundsNet(): number {
  if (typeof window === "undefined") return 0;
  const txs = read<{ type: string; amount: number }[]>(FUNDS_KEY, []);
  return txs.reduce((a, t) => a + (t.type === "ADD" ? t.amount : -t.amount), 0);
}

// Net cash spent on paper fills (open + closed). Positive = cash out.
export function getNetSpent(): number {
  return getTrades().reduce(
    (a, t) => a + (t.side === "BUY" ? t.value : -t.value),
    0,
  );
}

// Total brokerage paid across the tradebook (admin-configured).
export function getTotalCharges(): number {
  return getTrades().reduce((a, t) => a + (t.charges ?? 0), 0);
}

export function tradeCharges(value: number): number {
  const p = getPublicConfig().trading;
  const flat = Number(p?.brokerageFlat ?? 0) || 0;
  const pct = Number(p?.brokeragePct ?? 0) || 0;
  return flat + (value * pct) / 100;
}

// One wallet across backend cash + top-ups − fills − brokerage.
// Once the server account has loaded, ITS derived cash is authoritative — the
// local formula survives only for a browser holding local-only fills (the
// anonymous demo path).
export function getWalletBalance(backendCash: number): number {
  if (serverAccount) return serverAccount.cash;
  // `/auth/getAccountDetails` now returns the derived free margin, which has
  // already netted off fills, charges and deposits. Re-running the local
  // arithmetic on it would subtract every fill a second time.
  if (hasServerCash()) return backendCash || 0;
  return (backendCash || 0) + getFundsNet() - getNetSpent() - getTotalCharges();
}

// ── Deposits & the KYC gate ────────────────────────────────────────────────

/**
 * Fund the account. The server is the only writer: it validates the amount,
 * appends it to the deposit ledger, and returns the new account so the wallet and
 * the KYC progress move in the same round trip. `idem` makes a double-submit
 * harmless — the same key is absorbed rather than credited twice.
 */
export async function depositFunds(
  amount: number,
): Promise<{ ok: boolean; error?: string; deposited?: number }> {
  if (typeof window === "undefined" || !authToken())
    return { ok: false, error: "Sign in to add funds" };
  try {
    const r = await fetch("/api/trade/deposit", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        amount,
        idem: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      return { ok: false, error: String(j?.error || "Deposit was refused") };
    if (j?.account) setServerAccount(j.account);
    return { ok: true, deposited: Number(j?.deposited) || 0 };
  } catch {
    return { ok: false, error: "Network error — nothing was credited" };
  }
}

/**
 * The KYC deposit gate. The server computes eligibility inside the account
 * payload, so that is used whenever it has loaded; the published threshold is
 * only a placeholder so the page can state the rule before the first fetch.
 */
export function useKycGate(): KycGate & { loaded: boolean } {
  const acct = useTradingAccount();
  const cfg = usePublicConfig();
  const deposited = acct ? acct.deposited : 0;
  const required = acct ? acct.kycMinDeposit : Number(cfg.kyc?.minDeposit) || 0;
  return { ...kycGate(deposited, required), loaded: !!acct };
}

// Margin % the platform is currently charging this user. The server is the
// authority (per-user override, else platform default); the public config is
// the pre-login fallback so the ticket can still quote a number.
export function getMarginPct(): number {
  const fromServer = Number(serverAccount?.marginPct);
  if (Number.isFinite(fromServer) && fromServer >= 1 && fromServer <= 100)
    return fromServer;
  const fromCfg = Number(getPublicConfig().trading?.marginPct);
  if (Number.isFinite(fromCfg) && fromCfg >= 1 && fromCfg <= 100)
    return fromCfg;
  return 5;
}

/** Cash that must be posted to open `value` of new exposure. */
export function marginFor(value: number): number {
  return (Math.max(0, value) * getMarginPct()) / 100;
}

// With margin, "can I afford it" means "can I post the margin", not the full
// trade value.
export function canAfford(backendCash: number, value: number): boolean {
  return getWalletBalance(backendCash) >= marginFor(value);
}

export function logTrade(
  e: Omit<TradeEntry, "id" | "at" | "value" | "charges">,
): TradeEntry {
  const value = e.qty * e.price;
  const entry: TradeEntry = {
    ...e,
    id: Math.random().toString(36).slice(2),
    at: Date.now(),
    value,
    charges: tradeCharges(value),
  };
  const list = getTrades();
  list.push(entry);
  saveTrades(list);
  return entry;
}

// Position bookkeeping (avg-price). Returns updated list.
export function applyFill(
  scrip: string,
  qty: number,
  price: number,
  side: FillSide,
  meta?: Partial<TradePos>,
): TradePos[] {
  const list = getPositions();
  // One row per (scrip, product) — see app/lib/positionKeys.ts. A delivery
  // holding and an intraday leg are separate positions even on the same name.
  const key = legKey(scrip, meta?.product);
  const i = list.findIndex((p) => legKey(p.scrip, p.product) === key);
  if (i < 0) {
    list.push({
      scrip,
      qty: side === "BUY" ? qty : -qty,
      avg: price,
      side: side === "BUY" ? "LONG" : "SHORT",
      kind: meta?.kind ?? "STOCK",
      product: normalizeProduct(meta?.product),
      underlying: meta?.underlying,
      expiry: meta?.expiry,
      strike: meta?.strike,
      optionSide: meta?.optionSide,
      lotSize: meta?.lotSize ?? 1,
    });
  } else {
    const p = list[i];
    const newQty = p.qty + (side === "BUY" ? qty : -qty);
    if (newQty === 0) {
      list.splice(i, 1);
    } else {
      const sameDir = Math.sign(newQty) === Math.sign(p.qty);
      if (!sameDir) {
        // Flipped straight through zero: the remainder opens at this price.
        p.avg = price;
      } else {
        const absOld = Math.abs(p.qty);
        const absNew = Math.abs(newQty);
        // Only ADDED units move the average. Reducing a position leaves it
        // untouched — the old formula reused the fill quantity in the numerator
        // while dividing by the smaller new size, so any partial exit multiplied
        // the average (6 @ ₹166.89 after selling 3 read back as ₹500.67).
        if (absNew > absOld) p.avg = (absOld * p.avg + qty * price) / absNew;
      }
      p.qty = newQty;
      p.side = newQty >= 0 ? "LONG" : "SHORT";
      if (meta?.kind) p.kind = meta.kind;
      if (meta?.underlying) p.underlying = meta.underlying;
      if (meta?.expiry) p.expiry = meta.expiry;
      if (meta?.strike) p.strike = meta.strike;
      if (meta?.optionSide) p.optionSide = meta.optionSide;
      if (meta?.lotSize) p.lotSize = meta.lotSize;
    }
  }
  savePositions(list);
  return list;
}

// One call for a paper fill: wallet check on BUY-to-open/long, then
// position update + immutable tradebook entry. Throws on insufficient funds.
export function executeFill(args: {
  scrip: string;
  qty: number;
  price: number;
  side: FillSide;
  kind: InstrumentKind;
  backendCash: number;
  product?: "CNC" | "MIS";
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionSide?: "CE" | "PE";
  lotSize?: number;
  /**
   * Exchange this instrument trades on. Callers MUST pass it for a commodity:
   * without it the session check below falls back to NSE and refuses every
   * order placed after the 15:30 cash close — the whole MCX evening session.
   */
  segment?: ExchangeCode;
}): { entry: TradeEntry; positions: TradePos[]; wallet: number } {
  const cfg = getPublicConfig();
  const rules = cfg.trading;
  if (rules?.haltFills) throw new Error("Fills halted by admin (kill switch)");
  // Same gate the server enforces, run first so the failure is instant and the
  // optimistic position is never applied for an order that cannot be booked.
  //
  // It has to be SEGMENT-AWARE. This call used to omit the segment, which
  // defaults to NSE, so a commodity order between 15:30 and 23:30 was thrown on
  // here — by the client — even though the ticket's own check and the server
  // would both have accepted it. The calendar is passed for the same reason:
  // without it this gate ignored exchange holidays and disagreed with the
  // ledger about what was open.
  const segment =
    args.segment ?? cachedInstrument(args.scrip)?.segment ?? EQUITY_EXCHANGE;
  const session = orderWindow(
    cfg.marketHours,
    rules?.allowAfterHours === true,
    new Date(),
    segment,
    cfg.calendar ?? null,
  );
  if (!session.allowed) throw new Error(session.reason);
  if (rules?.maxQty && args.qty > rules.maxQty)
    throw new Error(`Quantity capped at ${rules.maxQty} by risk rules`);
  const existing = getPositions().find(
    (p) => legKey(p.scrip, p.product) === legKey(args.scrip, args.product),
  );
  const opensShort =
    args.side === "SELL" && (!existing || existing.qty - args.qty < 0);
  if (opensShort && rules && rules.allowShort === false)
    throw new Error("Short selling is disabled by admin");
  if (
    !existing &&
    rules?.maxPositions &&
    getPositions().length >= rules.maxPositions
  )
    throw new Error(`Position limit reached (${rules.maxPositions})`);
  const value = args.qty * args.price;
  if (args.side === "BUY" && !canAfford(args.backendCash, value)) {
    const pct = getMarginPct();
    throw new Error(
      `Insufficient margin: need ₹${marginFor(value).toFixed(0)} ` +
        `(${pct}% of ₹${value.toFixed(0)}), have ₹${getWalletBalance(
          args.backendCash,
        ).toFixed(0)}`,
    );
  }
  const positions = applyFill(args.scrip, args.qty, args.price, args.side, {
    kind: args.kind,
    product: args.product,
    underlying: args.underlying,
    expiry: args.expiry,
    strike: args.strike,
    optionSide: args.optionSide,
    lotSize: args.lotSize ?? 1,
  });
  const entry = logTrade({
    scrip: args.scrip,
    side: args.side,
    qty: args.qty,
    price: args.price,
    kind: args.kind,
    product: args.product,
    underlying: args.underlying,
    expiry: args.expiry,
    strike: args.strike,
    optionSide: args.optionSide,
    lotSize: args.lotSize ?? 1,
  });
  // The fill only COUNTS once the server ledger accepts it (price sanity, cash,
  // holdings, risk rules). This is fire-and-forget so the UI stays instant; a
  // rejection snaps the local mirror back to server truth and emits
  // "fs-ledger-rejected" for the toast layer.
  void submitFill({
    entry,
    kind: args.kind,
    product: args.product,
    underlying: args.underlying,
    expiry: args.expiry,
    strike: args.strike,
    optionSide: args.optionSide,
    lotSize: args.lotSize ?? 1,
  });
  return { entry, positions, wallet: getWalletBalance(args.backendCash) };
}

// Realized P&L from completed round-trips. The server's number wins whenever it
// is available — it is derived from validated fills only, so it cannot be
// inflated from the browser.
export function getRealizedPnl(): number {
  if (serverAccount) return serverAccount.realizedPnl;
  // Mirror of deriveAccount: walk the FILLS and bank a round-trip the moment a
  // scrip returns to flat. Reading the current positions instead (the old
  // approach) dropped the P&L of any scrip that was closed and later reopened.
  const qty = new Map<string, number>();
  const net = new Map<string, number>();
  let pnl = 0;
  for (const t of getTrades()
    .slice()
    .sort((a, b) => a.at - b.at)) {
    const q = (qty.get(t.scrip) || 0) + (t.side === "BUY" ? t.qty : -t.qty);
    const n =
      (net.get(t.scrip) || 0) + (t.side === "SELL" ? t.value : -t.value);
    if (q === 0) {
      pnl += n;
      qty.delete(t.scrip);
      net.delete(t.scrip);
    } else {
      qty.set(t.scrip, q);
      net.set(t.scrip, n);
    }
  }
  return pnl;
}
