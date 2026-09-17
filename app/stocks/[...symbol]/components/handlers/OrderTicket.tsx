"use client";
import { useEffect, useState } from "react";
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
import { DEPTH_PICK_EVENT } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import { money } from "@/app/lib/format";

const MARGIN: Record<Product, number> = { CNC: 1, MIS: 5 };

export default function OrderTicket(props: {
  symbol: string;
  companyName: string;
  ltp: number;
  side: "BUY" | "SELL";
  onClose: () => void;
}) {
  const token = getCookie("token") as string | undefined;
  const { orderDefaults, trading: tradingRules } = usePublicConfig();
  const session = useOrderWindow();
  const marketClosed = !session.allowed;
  const [qty, setQty] = useState(() => {
    if (typeof window === "undefined") return orderDefaults?.defaultQty || 1;
    const saved = Number(
      localStorage.getItem("fs_default_qty") ||
        String(orderDefaults?.defaultQty || 1),
    );
    return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 1;
  });
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
        const q = d.qty;
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
  const estValue =
    qty * (orderType === "MARKET" ? liveLtp : limitPrice || liveLtp);
  // MIS shows 5x leverage but orders block full value, so the
  // margin line is informational — the wallet check below uses estValue.
  const marginReq = estValue / (MARGIN[product] || 1);
  const charges =
    (tradingRules?.brokerageFlat ?? 0) +
    (estValue * (tradingRules?.brokeragePct ?? 0)) / 100;
  const [walletNow, setWalletNow] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { getBackendCash, getWalletBalance } =
          await import("@/app/lib/trading");
        setWalletNow(getWalletBalance(getBackendCash()));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  async function fire(side: "BUY" | "SELL", execPrice: number) {
    // The server ledger is the source of truth — settle locally for instant
    // feedback, then let the server record the session activity.
    const { executeFill: executePaperFill, getBackendCash } =
      await import("@/app/lib/trading");
    try {
      executePaperFill({
        scrip: decodeURIComponent(props.symbol),
        qty,
        price: execPrice,
        side,
        kind: "STOCK",
        product,
        backendCash: getBackendCash(),
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
          quantity: qty,
          price: execPrice,
        },
      }).catch(() => {});
    }
    sileo.success({
      title: `${side} ${qty} ${props.symbol} @ ₹${execPrice.toFixed(2)} [${orderType}/${product}]`,
      description: `Est. value ₹${(qty * execPrice).toFixed(0)} · Margin blocked ₹${((qty * execPrice) / (MARGIN[product] || 1)).toFixed(0)}${charges > 0 ? ` · Charges ₹${charges.toFixed(2)}` : ""}`,
    });
    props.onClose();
  }

  async function submit(e: any) {
    e.preventDefault();
    if (qty <= 0) return;
    if (!session.allowed) {
      sileo.error({ title: session.reason || "Market is closed" });
      return;
    }
    if (tradingRules?.haltFills) {
      sileo.error({ title: "Fills halted by admin (kill switch)" });
      return;
    }
    if (tradingRules?.maxQty && qty > tradingRules.maxQty) {
      sileo.error({
        title: `Quantity capped at ${tradingRules.maxQty} by risk rules`,
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
      if (!pos || pos.qty < qty) {
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
        `${props.side} ${qty} ${decodeURIComponent(props.symbol)} @ ₹${(orderType === "MARKET" ? liveLtp : limitPrice || liveLtp).toFixed(2)}?`,
      );
      if (!ok) return;
    }
    setLoading(true);
    try {
      if (orderType === "MARKET") {
        if (props.side === "BUY") {
          const { canAfford, getBackendCash, getWalletBalance } =
            await import("@/app/lib/trading");
          const w = getWalletBalance(getBackendCash());
          setWalletNow(w);
          if (!canAfford(getBackendCash(), estValue)) {
            sileo.error({
              title: `Insufficient wallet — need ₹${estValue.toFixed(0)}, have ₹${w.toFixed(0)}`,
            });
            return;
          }
        }
        await fire(props.side, liveLtp);
      } else {
        addPending({
          scrip: decodeURIComponent(props.symbol),
          side: props.side,
          qty,
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
              Quantity
            </label>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) =>
                setQty(Math.max(1, parseInt(e.target.value) || 1))
              }
              className="min-h-[44px] w-full rounded-md border border-border px-3 py-2 font-mono text-base tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:text-[13px]"
            />
          </div>
          {orderType === "LIMIT" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Limit price
              </label>
              <input
                type="number"
                step="0.05"
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
                step="0.05"
                value={triggerPrice}
                onChange={(e) =>
                  setTriggerPrice(parseFloat(e.target.value) || 0)
                }
                className="w-full border border-border px-3 py-3 md:py-2 text-base md:text-sm font-mono min-h-[44px]"
              />
            </div>
          )}
          <div className="text-[12.5px] text-muted-foreground">
            Est. value {money(estValue, 2)} · Margin {money(marginReq, 2)}
            {charges > 0 && <> · Charges {money(charges, 2)}</>}
            {product === "MIS" && (
              <span className="block text-[11px] text-muted-foreground/80">
                MIS 5x is display-only — orders block full value.
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
            disabled={loading || qty <= 0 || marketClosed}
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
