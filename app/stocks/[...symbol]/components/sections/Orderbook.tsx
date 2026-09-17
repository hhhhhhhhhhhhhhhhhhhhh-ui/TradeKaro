"use client";
import { useMemo } from "react";
import { useOrderBook } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import {
  formatBookTime,
  formatPrice,
  formatQty,
} from "@/app/stocks/[...symbol]/components/hooks/bookFormat";
import { pickDepth } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import DepthHeader from "@/app/stocks/[...symbol]/components/sections/DepthHeader";
import ImbalanceBar from "@/app/stocks/[...symbol]/components/sections/ImbalanceBar";

const LEVELS = 10;

// Tabular bid/ask book sharing the live hook; rows prefill the ticket.
export default function Orderbook(props: any) {
  const symbol = decodeURIComponent(props.symbol);
  const { bids, asks, tsMillis, loading, live } = useOrderBook(symbol, 5000);
  const topBids = useMemo(() => bids.slice(0, LEVELS), [bids]);
  const topAsks = useMemo(() => asks.slice(0, LEVELS), [asks]);
  const maxQ = Math.max(
    1,
    ...topBids.map((b) => b.qty),
    ...topAsks.map((a) => a.qty),
  );
  const totBid = topBids.reduce((a, b) => a + b.qty, 0);
  const totAsk = topAsks.reduce((a, b) => a + b.qty, 0);
  const rows = Math.max(topBids.length, topAsks.length);
  const updated = formatBookTime(tsMillis);

  const cell = (
    price: number,
    qty: number,
    side: "bid" | "ask",
    best: boolean,
  ) => {
    const tone = side === "bid" ? "text-positive" : "text-negative";
    const bar = side === "bid" ? "bg-positive/10" : "bg-negative/10";
    const onPick = () => pickDepth(price, side === "bid" ? "SELL" : "BUY", qty);
    return (
      <button
        type="button"
        onClick={onPick}
        title={`${side === "bid" ? "Sell @ " : "Buy @ "}${formatPrice(price)}`}
        className={`row-slide pressable relative flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left focus:outline-none focus-visible:brand-ring ${best ? "bg-muted/60" : "hover:bg-muted"}`}
      >
        <span
          className={`absolute inset-y-0 left-0 ${bar}`}
          style={{ width: `${Math.min(100, (qty / maxQ) * 100)}%` }}
        />
        <span
          className={`relative display-num text-sm ${best ? tone + " font-semibold" : ""}`}
        >
          {formatPrice(price)}
        </span>
        <span className={`relative display-num text-sm ${tone}`}>
          {formatQty(qty)}
        </span>
      </button>
    );
  };

  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <DepthHeader
        title={`Order book · ${LEVELS} levels`}
        live={live}
        updatedLabel={updated ? `UPDATED · ${updated}` : undefined}
      />
      {!loading && rows > 0 && <ImbalanceBar totBid={totBid} totAsk={totAsk} />}
      {loading ? (
        <div className="divide-y divide-border" aria-label="Loading order book">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-2">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="skeleton inline-block h-4 w-20" />
                <span className="skeleton inline-block h-4 w-16" />
              </div>
              <div className="hidden sm:flex items-center justify-between px-4 py-2.5 border-l border-border">
                <span className="skeleton inline-block h-4 w-20" />
                <span className="skeleton inline-block h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : rows === 0 ? (
        <div className="p-5 text-[13px] text-muted-foreground">
          Book is empty right now — thin liquidity. Try again after a refresh.
        </div>
      ) : (
        <>
          <div className="hidden sm:grid sm:grid-cols-2 bg-muted border-b border-border">
            <div className="eyebrow px-4 py-2">Bid · Price · Qty</div>
            <div className="eyebrow px-4 py-2 border-l border-border">
              Ask · Price · Qty
            </div>
          </div>
          <table className="w-full border-collapse">
            <caption className="sr-only">Bid and ask order book</caption>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => {
                const buy = topBids[i];
                const sell = topAsks[i];
                return (
                  <tr
                    key={`book-${i}`}
                    className="border-b border-border last:border-b-0 align-top"
                  >
                    <td className="p-0 sm:border-r border-border">
                      <span className="sm:hidden eyebrow block px-4 pt-2">
                        Bid
                      </span>
                      {buy ? (
                        cell(buy.price, buy.qty, "bid", i === 0)
                      ) : (
                        <span className="block px-4 py-2.5 text-foreground/30">
                          —
                        </span>
                      )}
                    </td>
                    <td className="p-0 border-t sm:border-t-0 border-border">
                      <span className="sm:hidden eyebrow block px-4 pt-2">
                        Ask
                      </span>
                      {sell ? (
                        cell(sell.price, sell.qty, "ask", i === 0)
                      ) : (
                        <span className="block px-4 py-2.5 text-foreground/30">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border bg-muted flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">
              TOT BID {totBid.toLocaleString("en-IN")} · TOT ASK{" "}
              {totAsk.toLocaleString("en-IN")}
            </span>
            <span className="text-[10px] font-mono text-foreground/40 hidden sm:inline">
              click a price to prefill ticket
            </span>
          </div>
        </>
      )}
    </div>
  );
}
