"use client";
import { useEffect, useMemo, useState } from "react";
import HoldingTable from "../components/HoldingTable";
import AnalyticsPanel from "../components/AnalyticsPanel";
import FundsPanel from "../components/FundsPanel";
import LivePnlStrip from "@/app/components/LivePnlStrip";
import { money } from "@/app/lib/format";
import { useLivePnl } from "@/app/hooks/useLivePnl";
import {
  getRealizedPnl,
  getTrades,
  getWalletBalance,
  setBackendCash,
} from "@/app/lib/trading";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import Loading from "@/app/components/Loading";

export default function Networth(props: any) {
  const { data, profitDetails, loading } = props;

  // Positions now live on their own page (/positions), so this screen covers
  // holdings, orders and funds only.
  const [tab, setTab] = useState<"HOLDINGS" | "ORDERS" | "FUNDS">("HOLDINGS");
  const [paperRev, setPaperRev] = useState(0);
  // Counts below come from localStorage, which the server cannot see. Render
  // them as 0 until mounted so hydration matches (was a real mismatch bug).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const pnl = useLivePnl();

  useEffect(() => {
    const h = () => setPaperRev((t) => t + 1);
    window.addEventListener("storage", h);
    window.addEventListener("fs-ledger", h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener("fs-ledger", h);
    };
  }, []);

  useEffect(() => {
    if (typeof data?.remainingCash === "number") {
      setBackendCash(data.remainingCash);
    }
  }, [data?.remainingCash]);

  const hasData = !loading && data && Object.keys(data).length > 0;
  // Unified net worth: backend holdings + paper wallet, live MTM on top.
  // backendValue = invested + backend unrealized; portfolio adds paper realized
  // + live open MTM so header matches the strip exactly.
  const backendValue =
    hasData && data.spentCash !== undefined
      ? data.spentCash + (profitDetails?.overallProfit || 0)
      : 0;
  const backendProfit = hasData ? profitDetails?.overallProfit || 0 : 0;
  // Both of these read localStorage. `typeof window` is not a safe guard here
  // — it is false during the client's hydration pass too — so use the mounted
  // flag that was already declared for exactly this reason.
  const paperRealized = mounted ? getRealizedPnl() : 0;
  const paperOpen = pnl.positions.length;
  const wallet = mounted
    ? getWalletBalance(data.remainingCash || 0)
    : data.remainingCash || 0;
  // Live total = backend unrealized + paper realized + paper open MTM.
  const liveTotal = backendProfit + pnl.total;
  const portfolioValue = backendValue + paperRealized + pnl.unrealized;
  const overallProfit = backendProfit + paperRealized + pnl.unrealized;
  const profitPercent =
    hasData && data?.spentCash && data.spentCash > 0
      ? ((overallProfit / data.spentCash) * 100).toFixed(2)
      : "0.00";
  const isProfitPositive = overallProfit >= 0;

  // Sorted holdings biggest-first (demat style).
  const sortedScrips = useMemo(() => {
    const arr: any[] = Array.isArray(data?.scrips) ? [...data.scrips] : [];
    return arr.sort(
      (a, b) =>
        (b.quantity || 0) * (b.buyPrice || 0) -
        (a.quantity || 0) * (a.buyPrice || 0),
    );
  }, [data?.scrips]);

  // Unified recent orders: broker book + paper fills, newest first.
  const unifiedOrders = useMemo(() => {
    const out: {
      id: string;
      scrip: string;
      side: "BUY" | "SELL";
      qty: number;
      price: number;
      at: number;
      source: "BROKER" | "PAPER";
      kind: "STOCK" | "OPTION";
      rawTime?: string;
    }[] = [];
    const book: any[] = Array.isArray(data?.orderBook) ? data.orderBook : [];
    for (const o of book) {
      if (!o?.scrip) continue;
      const ms = o.time ? Date.parse(o.time) : 0;
      out.push({
        id: `broker-${o.scrip}-${o.time || Math.random()}`,
        scrip: String(o.scrip),
        side: o.type === "SELL" ? "SELL" : "BUY",
        qty: Number(o.quantity) || 0,
        price: Number(o.price) || 0,
        at: Number.isFinite(ms) ? ms : 0,
        source: "BROKER",
        kind: "STOCK",
        rawTime: o.time,
      });
    }
    try {
      for (const t of getTrades()) {
        out.push({
          id: `paper-${t.id}`,
          scrip: t.scrip,
          side: t.side,
          qty: t.qty,
          price: t.price,
          at: t.at,
          source: "PAPER",
          kind: t.kind,
        });
      }
    } catch {
      /* ssr */
    }
    return out.sort((a, b) => b.at - a.at);
  }, [data?.orderBook, paperRev]);
  const recentOrders = unifiedOrders.slice(0, 8);

  const TABS = [
    { id: "HOLDINGS", label: `Holdings · ${sortedScrips.length}` },
    {
      id: "ORDERS",
      label: `Orders · ${mounted ? unifiedOrders.length : 0}`,
    },
    { id: "FUNDS", label: "Funds" },
  ] as const;

  const allocTop = sortedScrips.slice(0, 5);
  const allocTotal =
    sortedScrips.reduce(
      (a: number, s: any) => a + (s.quantity || 0) * (s.buyPrice || 0),
      0,
    ) || 1;

  function fmtMoney(v: number): string {
    return `${v >= 0 ? "+" : "−"}₹${Math.abs(v).toFixed(0)}`;
  }

  return (
    <div className="space-y-3">
      <LivePnlStrip />
      <div className="broker-card px-4 sm:px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Portfolio value</div>
            {loading ? (
              <div className="flex items-center py-1">
                <Loading />
              </div>
            ) : (
              <>
                <div className="display-num text-[26px] font-bold leading-tight sm:text-[32px]">
                  {money(portfolioValue)}
                </div>
                <div
                  className={`text-[13px] font-mono font-semibold ${isProfitPositive ? "text-positive" : "text-negative"}`}
                >
                  {fmtMoney(overallProfit)} ({isProfitPositive ? "+" : ""}
                  {profitPercent}%)
                  <span className="ml-2 text-foreground/45 font-normal">
                    {pnl.live ? "· LIVE" : "· DELAYED"}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="eyebrow">Wallet</div>
            <div className="display-num text-xl font-bold sm:text-2xl">
              {money(wallet)}
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              Broker {money(data.remainingCash || 0)}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="border border-border px-2 py-2">
            <div className="eyebrow">Holdings</div>
            <div className="display-num text-base font-bold">
              {sortedScrips.length}
            </div>
          </div>
          <div className="border border-border px-2 py-2">
            <div className="eyebrow">Open</div>
            <div className="display-num text-base font-bold">{paperOpen}</div>
          </div>
          <div className="border border-border px-2 py-2">
            <div className="eyebrow">Realized</div>
            <div
              className={`display-num text-base font-bold ${paperRealized >= 0 ? "text-positive" : "text-negative"}`}
            >
              {fmtMoney(paperRealized)}
            </div>
          </div>
        </div>
      </div>
      {/* ── Tabs ── */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Portfolio sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`pressable h-9 shrink-0 rounded-md border px-4 text-[12px] font-semibold transition-colors ${tab === t.id ? "border-transparent bg-foreground text-background" : "border-border bg-card text-foreground/70 hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
        <NavTransition
          href="/portfolio/orders"
          className="pressable h-9 shrink-0 px-4 text-[12px] font-mono border border-border bg-card text-foreground/70 inline-flex items-center"
        >
          ALL ORDERS →
        </NavTransition>
      </div>
      {tab === "HOLDINGS" && (
        <div className="space-y-3">
          {allocTop.length > 0 && (
            <div className="broker-card px-4 py-3">
              <div className="eyebrow mb-2">Top allocation</div>
              <div className="space-y-1.5">
                {allocTop.map((s: any) => {
                  const v = (s.quantity || 0) * (s.buyPrice || 0);
                  const pct = (v / allocTotal) * 100;
                  return (
                    <div
                      key={s.scrip}
                      className="flex items-center gap-2 text-[11px] font-mono"
                    >
                      <span className="w-20 truncate font-semibold">
                        {s.scrip}
                      </span>
                      <span className="flex-1 h-1.5 bg-muted overflow-hidden">
                        <span
                          className="block h-full brand-gradient"
                          style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                        />
                      </span>
                      <span className="w-12 text-right display-num text-foreground/60">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="broker-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="eyebrow">
                Holdings · {sortedScrips.length} · biggest first
              </span>
            </div>
            {loading ? (
              <div className="flex justify-center items-center py-10">
                <Loading />
              </div>
            ) : (
              <HoldingTable
                profitData={
                  profitDetails.profitArray ? profitDetails.profitArray : []
                }
                data={sortedScrips}
              />
            )}
          </div>
          <AnalyticsPanel
            data={{ ...data, scrips: sortedScrips }}
            profitDetails={profitDetails}
            loading={loading}
          />
        </div>
      )}
      {tab === "ORDERS" && (
        <div className="broker-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="eyebrow">Recent orders · newest first</span>
            <NavTransition
              href="/portfolio/orders"
              className="text-[11px] font-mono text-positive hover:underline"
            >
              VIEW ALL →
            </NavTransition>
          </div>
          {!recentOrders.length ? (
            <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              No orders yet — buy a stock or fire an option leg.
            </div>
          ) : (
            <>
              <div className="sm:hidden divide-y divide-border">
                {recentOrders.map((o) => (
                  <div key={o.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-mono font-semibold truncate">
                        {o.scrip}
                      </span>
                      <span className="flex gap-1">
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 ${o.side === "BUY" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative"}`}
                        >
                          {o.side}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 border border-border text-foreground/60">
                          {o.source === "PAPER"
                            ? o.kind === "OPTION"
                              ? "PAPER·OPT"
                              : "PAPER·EQ"
                            : "BROKER"}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-foreground/60">
                      <span>
                        {o.qty} @ ₹{o.price.toFixed(1)}
                      </span>
                      <span className="display-num">
                        ₹{(o.qty * o.price).toFixed(0)}
                      </span>
                      <span>
                        {o.at
                          ? new Date(o.at).toLocaleDateString("en-IN")
                          : o.rawTime
                            ? new Date(o.rawTime).toLocaleDateString("en-IN")
                            : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <div className="grid grid-cols-6 gap-3 bg-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Scrip</span>
                  <span className="text-right">Qty @ Price</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">Side</span>
                  <span className="text-right">Source</span>
                  <span className="text-right">Time</span>
                </div>
                <div className="divide-y divide-border">
                  {recentOrders.map((o) => (
                    <div
                      key={o.id}
                      className="px-4 py-2 grid grid-cols-6 gap-3 text-[12px] font-mono items-center"
                    >
                      <span className="font-semibold truncate">{o.scrip}</span>
                      <span className="text-right display-num">
                        {o.qty} @ ₹{o.price.toFixed(1)}
                      </span>
                      <span className="text-right display-num">
                        ₹{(o.qty * o.price).toFixed(0)}
                      </span>
                      <span
                        className={`text-right font-bold ${o.side === "BUY" ? "text-positive" : "text-negative"}`}
                      >
                        {o.side}
                      </span>
                      <span className="text-right text-foreground/55">
                        {o.source === "PAPER"
                          ? o.kind === "OPTION"
                            ? "PAPER·OPT"
                            : "PAPER·EQ"
                          : "BROKER"}
                      </span>
                      <span className="text-right text-foreground/55">
                        {o.at
                          ? new Date(o.at).toLocaleString("en-IN", {
                              hour12: false,
                            })
                          : o.rawTime || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {tab === "FUNDS" && (
        <div className="space-y-3">
          <FundsPanel remainingCash={data.remainingCash || 0} />
        </div>
      )}
    </div>
  );
}
