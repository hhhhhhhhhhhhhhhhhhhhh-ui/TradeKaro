"use client";
import { apiURL } from "@/app/components/apiURL";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import axios from "axios";
import { getCookie } from "cookies-next";
import { useEffect, useMemo, useState } from "react";
import { getTrades, type TradeEntry } from "@/app/lib/trading";

type UnifiedRow = {
  id: string;
  scrip: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  value: number;
  at: number;
  kind: "STOCK" | "OPTION";
  rawTime?: string;
};

function toMs(t: any): number {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

export default function OrderPage() {
  const token = getCookie("token") as string | undefined;
  const [broker, setBroker] = useState<any[]>([]);
  const [paper, setPaper] = useState<TradeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"ALL" | "STOCK" | "OPTION">("ALL");

  useEffect(() => {
    async function getOrders() {
      try {
        const results = await axios({
          method: "post",
          url: apiURL + "/auth/getAccountDetails",
          headers: { Authorization: "Bearer " + token },
        });
        const book = results.data?.orderBook;
        setBroker(Array.isArray(book) ? book : []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    getOrders();
  }, [token]);

  useEffect(() => {
    const reload = () => {
      try {
        setPaper(getTrades());
      } catch {
        /* noop */
      }
    };
    reload();
    window.addEventListener("storage", reload);
    window.addEventListener("fs-ledger", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("fs-ledger", reload);
    };
  }, []);

  const rows: UnifiedRow[] = useMemo(() => {
    const out: UnifiedRow[] = [];
    for (const o of broker) {
      if (!o || !o.scrip) continue;
      const side = o.type === "SELL" ? "SELL" : "BUY";
      const qty = Number(o.quantity) || 0;
      const price = Number(o.price) || 0;
      out.push({
        id: `broker-${o.scrip}-${o.time || Math.random()}`,
        scrip: String(o.scrip),
        side: side as "BUY" | "SELL",
        qty,
        price,
        value: qty * price,
        at: o.time ? toMs(o.time) : 0,
        kind: "STOCK",
        rawTime: o.time,
      });
    }
    for (const t of paper) {
      out.push({
        id: `paper-${t.id}`,
        scrip: t.scrip,
        side: t.side,
        qty: t.qty,
        price: t.price,
        value: t.value,
        at: t.at,
        kind: t.kind,
      });
    }
    return out
      .filter((r) => kind === "ALL" || r.kind === kind)
      .sort((a, b) => b.at - a.at);
  }, [broker, paper, kind]);

  const paperCount = paper.length;
  const brokerCount = broker.length;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Orders
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {rows.length} fill{rows.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["ALL", "STOCK", "OPTION"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setKind(f)}
                className={`pressable h-[30px] px-3 text-[11px] font-mono border ${kind === f ? "bg-foreground text-background border-foreground" : "border-border bg-card hover:bg-muted"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-4 text-[11.5px] text-muted-foreground">
          Every fill (stocks + options) lands here instantly and moves the same
          wallet.
        </p>

        {loading ? (
          <div className="border border-border bg-card">
            <div className="border-b border-border bg-muted px-4 py-3">
              <div className="grid grid-cols-7 gap-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <div className="text-left">SCRIP</div>
                <div className="text-right">QTY</div>
                <div className="text-right">PRICE</div>
                <div className="text-right">VALUE</div>
                <div className="text-right">SIDE</div>
                <div className="text-right">SOURCE</div>
                <div className="text-right">TIME</div>
              </div>
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="grid grid-cols-7 gap-4">
                  {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                    <div key={j} className="h-4 w-20 bg-foreground/10"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="border border-border bg-card py-12 text-center">
            <p className="text-[13px] text-muted-foreground">
              {paperCount + brokerCount === 0
                ? "No orders yet — fire a stock order or tap a chain price."
                : "No fills match these filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-border border border-border bg-card">
              {rows.map((r) => {
                const isSell = r.side === "SELL";
                return (
                  <div key={`${r.id}-m`} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-mono font-semibold truncate">
                        {r.scrip}
                      </span>
                      <span
                        className={`text-[11px] font-mono font-semibold px-2 py-0.5 border ${isSell ? "text-negative border-negative/40" : "text-positive border-positive/40"}`}
                      >
                        {r.side}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span>
                        {r.qty} @ ₹{r.price.toFixed(2)}
                      </span>
                      <span
                        className={`broker-pill px-2 py-px ${r.kind === "OPTION" ? "bg-accent/10 text-accent" : "bg-brand/10 text-brand"}`}
                      >
                        {r.kind === "OPTION" ? "OPT" : "EQ"}
                      </span>
                      <span>
                        {r.at
                          ? new Date(r.at).toLocaleString("en-IN", {
                              hour12: false,
                            })
                          : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block w-full overflow-x-auto">
              <div className="border border-border bg-card min-w-[860px]">
                <div className="border-b border-border bg-muted px-4 py-3">
                  <div className="grid grid-cols-7 gap-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="text-left">SCRIP</div>
                    <div className="text-right">QTY</div>
                    <div className="text-right">PRICE</div>
                    <div className="text-right">VALUE</div>
                    <div className="text-right">SIDE</div>
                    <div className="text-right">TYPE</div>
                    <div className="text-right">TIME</div>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {rows.map((r) => {
                    const isSell = r.side === "SELL";
                    return (
                      <div
                        key={r.id}
                        className="px-4 py-3 hover:bg-muted transition-colors"
                      >
                        <div className="grid grid-cols-7 gap-4 text-sm font-mono items-center">
                          <div className="text-left">
                            {r.kind === "STOCK" ? (
                              <NavTransition
                                href={`/stocks/${encodeURIComponent(r.scrip)}`}
                                className="font-semibold text-foreground hover:underline"
                              >
                                {r.scrip}
                              </NavTransition>
                            ) : (
                              <span className="font-semibold text-foreground">
                                {r.scrip}
                              </span>
                            )}
                          </div>
                          <div className="text-right text-foreground">
                            {r.qty}
                          </div>
                          <div
                            className={`text-right font-semibold ${isSell ? "text-negative" : "text-positive"}`}
                          >
                            ₹{r.price.toFixed(2)}
                          </div>
                          <div className="text-right text-foreground">
                            ₹{r.value.toFixed(0)}
                          </div>
                          <div
                            className={`text-right font-semibold ${isSell ? "text-negative" : "text-positive"}`}
                          >
                            {r.side}
                          </div>
                          <div className="text-right">
                            <span
                              className={`broker-pill px-2 py-0.5 text-[11px] ${r.kind === "OPTION" ? "bg-accent/10 text-accent" : "bg-brand/10 text-brand"}`}
                            >
                              {r.kind === "OPTION" ? "OPT" : "EQ"}
                            </span>
                          </div>
                          <div className="text-right text-foreground text-xs">
                            {r.at
                              ? new Date(r.at).toLocaleString("en-IN", {
                                  hour12: false,
                                })
                              : "—"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
