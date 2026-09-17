"use client";
import { useEffect, useMemo, useState } from "react";
import { sileo } from "sileo";
import {
  canAfford,
  executeFill,
  getBackendCash,
  getPositions,
  getWalletBalance,
} from "@/app/lib/trading";
import { lotSizeFor } from "@/app/options/components/lots";
import type { ChainRow } from "@/app/options/components/optTypes";
import { money } from "@/app/lib/format";
import { useOrderWindow } from "@/app/hooks/useOrderWindow";

export type TicketSel = {
  strike: number;
  side: "CE" | "PE";
  action: "BUY" | "SELL";
  price: number;
} | null;

// Single-leg ticket: tap a chain price → confirm lots → fill.
export default function OptionTicket({
  underlying,
  expiry,
  ltp,
  rows,
  sel,
  onClear,
  onFilled,
}: {
  underlying: string;
  expiry: string;
  ltp: number;
  rows: ChainRow[];
  sel: TicketSel;
  onClear: () => void;
  onFilled: () => void;
}) {
  const lot = lotSizeFor(underlying);
  const [lots, setLots] = useState(1);
  const [confirmOff, setConfirmOff] = useState(false);
  const [wallet, setWallet] = useState<number | null>(null);
  const session = useOrderWindow("NFO");
  const marketClosed = !session.allowed;
  const openCount = useMemo(
    () =>
      typeof window === "undefined"
        ? 0
        : getPositions().filter(
            (p) => p.kind === "OPTION" && p.underlying === underlying,
          ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [underlying, sel],
  );

  useEffect(() => {
    setLots(1);
    try {
      setConfirmOff(localStorage.getItem("fs_confirm_orders") === "off");
      setWallet(getWalletBalance(getBackendCash()));
    } catch {
      /* noop */
    }
  }, [sel?.strike, sel?.side, sel?.action]);

  const openLeg = useMemo(
    () =>
      typeof window === "undefined" || !sel
        ? null
        : (getPositions().find(
            (p) =>
              p.kind === "OPTION" &&
              p.underlying === underlying &&
              p.expiry === expiry &&
              p.strike === sel.strike &&
              p.optionSide === sel.side,
          ) ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [underlying, expiry, sel?.strike, sel?.side, sel?.action],
  );

  if (!sel)
    return (
      <div className="broker-card px-4 sm:px-5 py-6 text-center">
        <div className="eyebrow">Order ticket</div>
        <div className="text-sm font-semibold mt-1">No leg selected</div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Tap a CE / PE price in the chain to trade it.
        </p>
      </div>
    );

  const liveRow = rows.find((r) => r.strike === sel.strike);
  const livePrice = sel.side === "CE" ? liveRow?.ceLtp : liveRow?.peLtp;
  const price = livePrice && livePrice > 0 ? livePrice : sel.price;
  const stale = !livePrice || livePrice <= 0;
  const units = lot * lots;
  const value = units * price;
  const walletNow = getWalletBalance(getBackendCash());
  const blocked = sel.action === "BUY" && !canAfford(getBackendCash(), value);
  // Demat-style preview: wallet after this fill + exit value of the open leg.
  const walletAfter =
    sel.action === "BUY" ? walletNow - value : walletNow + value;
  const exitMtm = openLeg ? (price - openLeg.avg) * openLeg.qty : 0;

  function fire() {
    const cur = sel;
    if (!cur) return;
    if (!session.allowed) {
      sileo.error({ title: session.reason || "Market is closed" });
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      sileo.error({ title: "No live premium — try another strike" });
      return;
    }
    if (cur.action === "BUY" && !canAfford(getBackendCash(), value)) {
      sileo.error({
        title: `Need ₹${value.toFixed(0)} — wallet ₹${getWalletBalance(getBackendCash()).toFixed(0)}`,
      });
      return;
    }
    if (
      !confirmOff &&
      typeof window !== "undefined" &&
      localStorage.getItem("fs_confirm_orders") !== "off" &&
      !window.confirm(
        `${cur.action} ${lots} lot${lots > 1 ? "s" : ""} ${underlying} ${cur.strike}${cur.side} @ ₹${price.toFixed(2)}?`,
      )
    )
      return;
    try {
      executeFill({
        scrip: `${underlying} ${expiry} ${cur.strike}${cur.side}`,
        qty: units,
        price,
        side: cur.action,
        kind: "OPTION",
        backendCash: getBackendCash(),
        underlying,
        expiry,
        strike: cur.strike,
        optionSide: cur.side,
        lotSize: lot,
        // NFO closes at 15:40, ten minutes after the cash market. Without this
        // the default NSE check refused the tail of every options session.
        segment: "NFO",
      });
      setWallet(getWalletBalance(getBackendCash()));
      sileo.success({
        title: `${cur.action} ${lots}×${underlying} ${cur.strike}${cur.side} @ ₹${price.toFixed(2)}`,
        description: `${units} units · ₹${value.toFixed(0)}`,
      });
      onFilled();
    } catch (e: any) {
      sileo.error({ title: e?.message || "Insufficient funds" });
    }
  }

  return (
    <div className="broker-card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between gap-2">
        <div>
          <div className="eyebrow">Order ticket</div>
          <div
            className={`text-base font-bold font-mono mt-0.5 ${sel.action === "BUY" ? "text-positive" : "text-negative"}`}
          >
            {sel.action} {sel.strike}
            {sel.side}
          </div>
        </div>
        <button
          onClick={onClear}
          className="pressable h-[30px] px-3 text-[11px] font-mono border border-border bg-muted"
        >
          CLEAR
        </button>
      </div>
      <div className="px-4 sm:px-5 py-3 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-muted-foreground">
            Premium {stale ? "· STALE" : "· LIVE"}
          </span>
          <span className="display-num text-2xl font-bold">
            {money(price, 2)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="border border-border px-2.5 py-2">
            <div className="text-foreground/45">LOT SIZE</div>
            <div className="display-num text-sm font-bold">{lot}</div>
          </div>
          <div className="border border-border px-2.5 py-2">
            <div className="text-foreground/45">EXPIRY</div>
            <div className="display-num text-sm font-bold">{expiry || "—"}</div>
          </div>
        </div>
        <div>
          <label
            htmlFor="opt-lots"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Lots · {units} units
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLots((v) => Math.max(1, v - 1))}
              className="pressable h-[44px] w-[44px] border border-border text-lg font-mono"
              aria-label="Fewer lots"
            >
              −
            </button>
            <input
              id="opt-lots"
              type="number"
              min={1}
              max={50}
              value={lots}
              onChange={(e) =>
                setLots(
                  Math.min(50, Math.max(1, parseInt(e.target.value) || 1)),
                )
              }
              className="h-[44px] flex-1 border border-border bg-card px-3 text-center text-base font-mono display-num"
            />
            <button
              onClick={() => setLots((v) => Math.min(50, v + 1))}
              className="pressable h-[44px] w-[44px] border border-border text-lg font-mono"
              aria-label="More lots"
            >
              +
            </button>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[1, 2, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => setLots(n)}
                className={`pressable h-[30px] flex-1 text-[11px] font-mono border ${lots === n ? "bg-foreground text-background border-foreground" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-2.5">
          <span className="text-[11.5px] text-muted-foreground">
            Order value
          </span>
          <span className="display-num text-lg font-bold">{money(value)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="border border-border px-2.5 py-2">
            <div className="text-foreground/45">WALLET AFTER</div>
            <div
              className={`display-num text-sm font-bold ${walletAfter < 0 ? "text-negative" : ""}`}
            >
              {money(walletAfter)}
            </div>
          </div>
          <div className="border border-border px-2.5 py-2">
            <div className="text-foreground/45">
              {openLeg ? "EXIT THIS LEG @ LIVE" : "NO OPEN LEG"}
            </div>
            <div
              className={`display-num text-sm font-bold ${openLeg ? (exitMtm >= 0 ? "text-positive" : "text-negative") : ""}`}
            >
              {openLeg
                ? `${exitMtm >= 0 ? "+" : "−"}₹${Math.abs(exitMtm).toFixed(0)}`
                : "—"}
            </div>
          </div>
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          Wallet {wallet == null ? "—" : money(wallet)} · {openCount} open{" "}
          {underlying} legs · spot {money(ltp)}
        </div>
        {blocked && (
          <div className="text-[11px] font-mono text-negative border border-negative/40 bg-negative/5 px-2.5 py-2">
            Insufficient margin for this BUY — lower lots or ask the admin for a
            higher leverage.
          </div>
        )}
        {marketClosed && (
          <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 border border-amber-500/40 bg-amber-500/5 px-2.5 py-2">
            {session.reason}
          </div>
        )}
        <button
          onClick={fire}
          disabled={blocked || price <= 0 || marketClosed}
          className={`pressable h-[48px] w-full rounded-md text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${sel.action === "BUY" ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground"}`}
        >
          {marketClosed
            ? "MARKET CLOSED"
            : `${sel.action} ${lots} LOT${lots > 1 ? "S" : ""} · ${money(value)}`}
        </button>
      </div>
    </div>
  );
}
