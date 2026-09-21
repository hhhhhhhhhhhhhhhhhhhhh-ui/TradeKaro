"use client";
import { useEffect, useRef, useState } from "react";
import { getApiURL } from "@/app/components/apiURL";
import axios from "axios";
import { getCookie } from "cookies-next";
import { sileo } from "sileo";
import Loading from "@/app/components/Loading";
import {
  addPending,
  type OrderType,
  type Product,
} from "@/app/lib/pendingOrders";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { useOrderWindow } from "@/app/hooks/useOrderWindow";
import { lotOf, useInstrument } from "@/app/hooks/useInstrument";
import { DEPTH_PICK_EVENT } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import { money } from "@/app/lib/format";

export default function OrderTicket(props: {
  symbol: string;
  companyName: string;
  ltp: number;
  side: "BUY" | "SELL";
  onClose: () => void;
}) {
  const token = getCookie("token") as string | undefined;
  const { orderDefaults, trading: tradingRules } = usePublicConfig();
  // What this symbol actually is. The ticket cannot infer any of this from the
  // name: GOLD is an MCX contract quoted in 100-unit lots and trading to 23:30,
  // SILVER is the same venue in 30-unit lots. Until the answer arrives the ticket
  // behaves as an equity, which is the safe direction — it never offers a lot
  // count it cannot back up with a real lot size, and the server gate enforces
  // the true lot regardless.
  const { meta } = useInstrument(props.symbol);
  const lot = lotOf(meta);
  const isCommodity = Boolean(meta?.isCommodity);
  // Fractional lots, down to one quoted unit. A whole MCX gold lot is about
  // ₹1.53 crore, so whole-lot-only would leave commodities unreachable on a
  // practice balance. The smallest step is one UNIT expressed in lots — 0.01 for
  // gold's 100-unit lot. The operator can turn this off from the console.
  const fractional = tradingRules?.fractionalLots !== false;
  const minLots = isCommodity && fractional ? 1 / lot : 1;
  // The session follows the instrument, not the app: MCX trades until 23:30 and
  // the cash market until 15:30, so a ticket fixed on NSE hours locked itself
  // eight hours before the commodity bell.
  const session = useOrderWindow(meta?.segment ?? "NSE");
  const marketClosed = !session.allowed;
  /** Set once the customer edits the field, so a late metadata reply cannot
   *  overwrite what they typed. */
  const qtyTouched = useRef(false);
  const [qty, setQty] = useState(() => {
    if (typeof window === "undefined") return orderDefaults?.defaultQty || 1;
    const saved = Number(
      localStorage.getItem("fs_default_qty") ||
        String(orderDefaults?.defaultQty || 1),
    );
    return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 1;
  });
  // A commodity default of "10" would read as ten LOTS — a thousand units of
  // silver, ₹2.2 lakh of exposure — so drop to the smallest tradable size the
  // moment we learn what this is, unless the customer has already typed
  // something. One unit rather than one lot, because one lot of gold does not
  // fit a practice balance.
  useEffect(() => {
    if (isCommodity && !qtyTouched.current) setQty(minLots);
  }, [isCommodity, minLots]);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [product, setProduct] = useState<Product>("CNC");
  const [limitPrice, setLimitPrice] = useState(props.ltp);
  const [triggerPrice, setTriggerPrice] = useState(props.ltp);
  const [depthHint, setDepthHint] = useState<string | null>(null);
  // Click-to-trade: depth rows dispatch price picks for this symbol.
  useEffect(() => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        price: number;
        side: "BUY" | "SELL";
        qty?: number;
      };
      if (!d || !Number.isFinite(d.price)) return;
      setOrderType((t) => (t === "MARKET" ? "LIMIT" : t));
      setLimitPrice(d.price);
      setTriggerPrice(d.price);
      if (typeof d.qty === "number") {
        // Depth quantities are in UNITS; this field counts LOTS for a commodity.
        const q = Math.max(1, Math.round(d.qty / lot));
        qtyTouched.current = true;
        setQty((prev) =>
          Math.max(prev, Math.min(q, tradingRules?.maxQty || 1000)),
        );
      }
      setDepthHint(`depth @ ₹${d.price.toFixed(2)}`);
    };
    window.addEventListener(DEPTH_PICK_EVENT, onPick);
    return () => window.removeEventListener(DEPTH_PICK_EVENT, onPick);
  }, []);
  const [loading, setLoading] = useState(false);
  const { ticks } = useLiveTicks([props.symbol], 3000);
  const liveLtp = ticks[props.symbol.toUpperCase()]?.ltp || props.ltp;
  // `qty` is what the customer typed (lots, possibly fractional for a
  // commodity). Everything downstream works in UNITS, so the valuation, margin
  // and charges arithmetic is identical for a commodity and an equity — and
  // matches the server, which only ever sees units.
  //
  // The rounding is not cosmetic: 0.01 × 100 is 1.0000000000000002 in binary
  // floating point, so an exact check would reject a perfectly valid 0.01 gold
  // lot. Units are snapped to an integer and the drift is bounded instead.
  const rawUnits = qty * lot;
  const units = Math.round(rawUnits);
  const unitsOk = units > 0 && Math.abs(rawUnits - units) < 1e-6;
  // "0.01 lots" reads better than "0.010000000000000002 lots".
  const lotCount = Number(qty.toFixed(4));
  const lotText = `${lotCount} lot${lotCount === 1 ? "" : "s"}`;
  // The contract's OWN tick, not a fixed 5 paise. The master has always carried
  // it and it was thrown away, so the stepper moved in 0.05 increments on an MCX
  // contract quoted in ₹1 steps — letting a customer pick a price the exchange
  // does not have, on the instrument where the error is largest.
  //
  // `contract.tick` arrives in RUPEES — /api/market/instrument divides the
  // master's paise by 100. It did not always: this stepper once read the raw
  // paise value, so gold stepped ₹100 at a time and the field was 100× too
  // coarse. Do not divide again here.
  const tickSize =
    Number(meta?.contract?.tick) > 0 ? Number(meta?.contract?.tick) : 0.05;
  const estValue =
    units * (orderType === "MARKET" ? liveLtp : limitPrice || liveLtp);
  const charges =
    (tradingRules?.brokerageFlat ?? 0) +
    (estValue * (tradingRules?.brokeragePct ?? 0)) / 100;
  const [walletNow, setWalletNow] = useState<number | null>(null);
  // The margin % the ledger will actually charge this user.
  //
  // There is NO per-product margin. The server computes
  // `required = openingUnits * price * pct / 100` from the account's single
  // `marginPct` — resolved as the admin's per-user override, else the platform
  // default in Settings → Trading & Risk. `product` selects the MIS square-off
  // window and nothing else.
  //
  // A table here used to declare `{ CNC: 1, MIS: 5 }`. That number was
  // invented: it quoted a margin the wallet check never used, it disagreed with
  // the ledger about what would be blocked, and moving the admin margin did not
  // move it — so an operator raising leverage saw the ticket keep saying 5×.
  //
  // Held in state rather than computed during render, for the same reason as
  // `walletNow`: `getMarginPct()` returns a value the SERVER resolved, so
  // calling it while rendering would print one figure on the server and a
  // different one on hydration.
  const [marginPct, setMarginPct] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { getBackendCash, getMarginPct, getWalletBalance } =
          await import("@/app/lib/trading");
        setWalletNow(getWalletBalance(getBackendCash()));
        setMarginPct(getMarginPct());
      } catch {
        /* ignore */
      }
    })();
  }, []);
  // Null until the account resolves. The line is omitted rather than shown as a
  // guess, because a wrong margin figure is worse than no figure at all.
  const marginReq = marginPct === null ? null : (estValue * marginPct) / 100;

  async function fire(side: "BUY" | "SELL", execPrice: number) {
    // The server ledger is the source of truth — settle locally for instant
    // feedback, then let the server record the session activity.
    const {
      executeFill: executePaperFill,
      getBackendCash,
      marginFor: marginOf,
    } = await import("@/app/lib/trading");
    try {
      executePaperFill({
        scrip: decodeURIComponent(props.symbol),
        qty: units,
        price: execPrice,
        side,
        kind: "STOCK",
        product,
        backendCash: getBackendCash(),
        // Without this the client gate checks the NSE session and refuses every
        // commodity order after 15:30.
        segment: meta?.segment,
      });
    } catch (err: any) {
      sileo.error({ title: err?.message || "Order failed" });
      return;
    }
    if (token) {
      const url =
        getApiURL() +
        (side === "BUY" ? "/transaction/buyScrip" : "/transaction/sellScrip");
      axios({
        method: "post",
        url,
        headers: { Authorization: "Bearer " + token },
        data: {
          scrip: decodeURIComponent(props.symbol),
          quantity: units,
          price: execPrice,
        },
      }).catch(() => {});
    }
    // A commodity is quoted in a lot count the customer recognises, but the
    // rupee figures are always the unit maths.
    const label = isCommodity
      ? `${units} ${props.symbol} (${lotText})`
      : `${qty} ${props.symbol}`;
    sileo.success({
      title: `${side} ${label} @ ₹${execPrice.toFixed(2)} [${orderType}/${product}]`,
      description: `Est. value ₹${(units * execPrice).toFixed(0)} · Margin blocked ₹${marginOf(units * execPrice).toFixed(0)}${charges > 0 ? ` · Charges ₹${charges.toFixed(2)}` : ""}`,
    });
    props.onClose();
  }

  async function submit(e: any) {
    e.preventDefault();
    if (!qty) return;
    if (!unitsOk) {
      sileo.error({
        title: isCommodity
          ? `${props.symbol} is quoted in whole units — ${Number(
              (1 / lot).toFixed(4),
            )} lot is the smallest step`
          : "Enter a whole quantity",
      });
      return;
    }
    if (!session.allowed) {
      sileo.error({ title: session.reason || "Market is closed" });
      return;
    }
    if (tradingRules?.haltFills) {
      sileo.error({ title: "Fills halted by admin (kill switch)" });
      return;
    }
    if (tradingRules?.maxQty && units > tradingRules.maxQty) {
      sileo.error({
        title: isCommodity
          ? `Quantity capped at ${tradingRules.maxQty} units (${Math.floor(
              tradingRules.maxQty / lot,
            )} lots) by risk rules`
          : `Quantity capped at ${tradingRules.maxQty} by risk rules`,
      });
      return;
    }
    if (tradingRules && !tradingRules.allowShort && props.side === "SELL") {
      const { getPositions } = await import("@/app/lib/trading");
      const { legKey } = await import("@/app/lib/positionKeys");
      // The leg being sold is the one this ticket's product belongs to: a
      // delivery holding cannot cover an intraday short on the same name.
      const pos = getPositions().find(
        (p) =>
          legKey(p.scrip, p.product) ===
          legKey(decodeURIComponent(props.symbol), product),
      );
      if (!pos || pos.qty < units) {
        sileo.error({ title: "Short selling is disabled by admin" });
        return;
      }
    }
    const needConfirm =
      orderDefaults?.confirmOrders ??
      (typeof window === "undefined" ||
        localStorage.getItem("fs_confirm_orders") !== "off");
    if (needConfirm) {
      const ok = window.confirm(
        `${props.side} ${
          isCommodity
            ? `${units} unit${units === 1 ? "" : "s"} (${lotText}) of `
            : `${qty} `
        }${decodeURIComponent(props.symbol)} @ ₹${(orderType === "MARKET" ? liveLtp : limitPrice || liveLtp).toFixed(2)}?`,
      );
      if (!ok) return;
    }
    setLoading(true);
    try {
      if (orderType === "MARKET") {
        if (props.side === "BUY") {
          const { canAfford, getBackendCash, getMarginPct, getWalletBalance } =
            await import("@/app/lib/trading");
          const w = getWalletBalance(getBackendCash());
          setWalletNow(w);
          // The gate below tests the MARGIN, so the message has to quote the
          // margin. It used to say "need ₹<full value>", which told a customer
          // who was short ₹900 of margin that they needed ₹18,000 — a number
          // no deposit of theirs would have been aimed at.
          const pct = getMarginPct();
          if (!canAfford(getBackendCash(), estValue)) {
            sileo.error({
              title: `Insufficient wallet — need ₹${((estValue * pct) / 100).toFixed(0)} margin (${pct}% of ₹${estValue.toFixed(0)}), have ₹${w.toFixed(0)}`,
            });
            return;
          }
        }
        await fire(props.side, liveLtp);
      } else {
        addPending({
          scrip: decodeURIComponent(props.symbol),
          side: props.side,
          qty: units,
          orderType,
          product,
          limitPrice: orderType === "LIMIT" ? limitPrice : undefined,
          triggerPrice: orderType !== "LIMIT" ? triggerPrice : undefined,
        });
        sileo.success({
          title: `${orderType} ${props.side} parked for ${props.symbol}`,
        });
        props.onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  const accent = props.side === "BUY" ? "text-positive" : "text-negative";
  return (
    <div className="bg-card p-4 md:p-6 w-full xl:min-w-[340px] xl:max-w-[420px] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] xl:pb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className={`text-xl font-bold font-mono ${accent}`}>
          {props.side} {props.symbol}
        </h1>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {isCommodity ? `${meta?.segmentLabel || "MCX"} · ` : ""}
          {money(liveLtp, 2)} live
        </span>
      </div>
      <p className="text-sm text-foreground/60 mb-4 truncate">
        {props.companyName}
        {depthHint && (
          <span className="ml-2 text-[11px] font-mono text-brand">
            · {depthHint}
          </span>
        )}
      </p>
      <form onSubmit={submit}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Type
              </label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType)}
                className="min-h-[44px] w-full rounded-md border border-border bg-card px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-[13px]"
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="SL">SL</option>
                <option value="GTT">GTT</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Product
              </label>
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value as Product)}
                className="min-h-[44px] w-full rounded-md border border-border bg-card px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-[13px]"
              >
                <option value="CNC">CNC (1x)</option>
                <option value="MIS">MIS (5x)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isCommodity ? "Lots" : "Quantity"}
            </label>
            <input
              type="number"
              min={minLots}
              step={minLots}
              value={qty}
              onChange={(e) => {
                qtyTouched.current = true;
                const n = parseFloat(e.target.value);
                setQty(Number.isFinite(n) && n > 0 ? n : minLots);
              }}
              className="min-h-[44px] w-full rounded-md border border-border px-3 py-2 font-mono text-base tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-[13px]"
            />
            {isCommodity && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {unitsOk ? (
                  <>
                    <span className="font-mono tabular-nums text-foreground/80">
                      {units}
                    </span>{" "}
                    unit{units === 1 ? "" : "s"} · lot size{" "}
                    <span className="font-mono tabular-nums text-foreground/80">
                      {lot}
                    </span>
                    {fractional ? (
                      <>
                        {" "}
                        · smallest order{" "}
                        <span className="font-mono tabular-nums">
                          {Number((1 / lot).toFixed(4))}
                        </span>{" "}
                        lot
                      </>
                    ) : null}
                    {meta?.contract?.expiry ? (
                      <> · expires {meta.contract.expiry}</>
                    ) : null}
                  </>
                ) : (
                  <>
                    Not a whole number of units.{" "}
                    <span className="font-mono tabular-nums">
                      {Number((1 / lot).toFixed(4))}
                    </span>{" "}
                    lot is the smallest step
                    {fractional ? "" : " — whole lots only right now"}.
                  </>
                )}
              </p>
            )}
          </div>
          {orderType === "LIMIT" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Limit price
              </label>
              <input
                type="number"
                step={tickSize}
                value={limitPrice}
                onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                className="min-h-[44px] w-full rounded-md border border-border px-3 py-2 font-mono text-base tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-[13px]"
              />
            </div>
          )}
          {(orderType === "SL" || orderType === "GTT") && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Trigger price
              </label>
              <input
                type="number"
                step={tickSize}
                value={triggerPrice}
                onChange={(e) =>
                  setTriggerPrice(parseFloat(e.target.value) || 0)
                }
                className="w-full border border-border px-3 py-3 md:py-2 text-base md:text-sm font-mono min-h-[44px]"
              />
            </div>
          )}
          <div className="text-[12.5px] text-muted-foreground">
            Est. value {money(estValue, 2)}
            {marginReq !== null && <> · Margin {money(marginReq, 2)}</>}
            {charges > 0 && <> · Charges {money(charges, 2)}</>}
            {/* The rate is stated outright. It previously read "MIS 5x is
                display-only — orders block full value", which was wrong twice
                over: the rate is not 5x unless the admin says so, and orders
                block margin, not full value. */}
            {marginPct !== null && (
              <span className="block text-[11px] text-muted-foreground/80">
                {`Margin is ${marginPct}% of trade value` +
                  (marginPct > 0
                    ? ` (up to ${Math.round((100 / marginPct) * 10) / 10}x)`
                    : "") +
                  ` — the same rate for CNC and MIS.`}
              </span>
            )}
            {walletNow !== null && (
              <span className="block text-[11px] text-muted-foreground/80">
                Wallet {money(walletNow)}
              </span>
            )}
          </div>
          {marketClosed && (
            <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11.5px] font-mono text-amber-600 dark:text-amber-400">
              {session.reason}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !unitsOk || marketClosed}
            className="w-full px-4 py-3 min-h-[52px] text-sm font-mono font-semibold border transition-colors disabled:opacity-50 bg-foreground text-background sticky bottom-0 active:scale-[0.99]"
          >
            {marketClosed ? (
              "MARKET CLOSED"
            ) : loading ? (
              <Loading />
            ) : orderType === "MARKET" ? (
              `${props.side} NOW`
            ) : (
              `PLACE ${orderType} ${props.side}`
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
