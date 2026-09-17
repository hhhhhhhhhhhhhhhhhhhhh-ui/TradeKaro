"use client";
import { useMemo } from "react";
import { useOrderBook } from "@/app/stocks/[...symbol]/components/hooks/useOrderBook";
import { formatBookTime } from "@/app/stocks/[...symbol]/components/hooks/bookFormat";
import DepthHeader from "@/app/stocks/[...symbol]/components/sections/DepthHeader";
import ImbalanceBar from "@/app/stocks/[...symbol]/components/sections/ImbalanceBar";
import DepthRow from "@/app/stocks/[...symbol]/components/sections/DepthRow";
import MidPriceRow from "@/app/stocks/[...symbol]/components/sections/MidPriceRow";

const LEVELS = 10;

// Live 10-level bid/ask ladder with depth bars, imbalance + mid price.
export default function DepthPanel(props: { symbol: string }) {
  const { bids, asks, tsMillis, loading, live } = useOrderBook(
    props.symbol,
    5000,
  );
  const topBids = useMemo(() => bids.slice(0, LEVELS), [bids]);
  const topAsks = useMemo(() => asks.slice(0, LEVELS), [asks]);
  const maxQ = Math.max(
    1,
    ...topBids.map((b) => b.qty),
    ...topAsks.map((a) => a.qty),
  );
  const totBid = topBids.reduce((a, b) => a + b.qty, 0);
  const totAsk = topAsks.reduce((a, b) => a + b.qty, 0);
  const cumBid: number[] = [];
  topBids.reduce((a, b, i) => (cumBid[i] = a + b.qty), 0);
  const cumAsk: number[] = [];
  topAsks.reduce((a, b, i) => (cumAsk[i] = a + b.qty), 0);
  const bestBid = topBids[0]?.price ?? 0;
  const bestAsk = topAsks[0]?.price ?? 0;
  const updated = formatBookTime(tsMillis);
  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <DepthHeader
        title={`Depth · ${LEVELS} levels`}
        live={live}
        updatedLabel={updated ? `UPDATED · ${updated}` : undefined}
      />
      {!loading && <ImbalanceBar totBid={totBid} totAsk={totAsk} />}
      {loading ? (
        <div className="divide-y divide-border" aria-label="Loading depth">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="skeleton inline-block h-4 w-20" />
              <span className="skeleton inline-block h-4 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <MidPriceRow bestBid={bestBid} bestAsk={bestAsk} />
          {/* asks on top (lowest first visually), bids below */}
          <table className="w-full border-collapse">
            <caption className="sr-only">Market depth asks then bids</caption>
            <tbody>
              <tr>
                <td
                  colSpan={3}
                  className="px-4 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70"
                >
                  Ask · Qty · Share
                </td>
              </tr>
              {topAsks.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-xs font-mono text-foreground/40">
                    No asks — thin book
                  </td>
                </tr>
              )}
              {[...topAsks].reverse().map((a, ri) => {
                const i = topAsks.length - 1 - ri;
                return (
                  <tr key={`ask-${a.price}-${i}`}>
                    <td colSpan={3} className="p-0">
                      <DepthRow
                        row={a}
                        side="ask"
                        best={i === 0}
                        cum={cumAsk[i]}
                        total={totAsk}
                        depthPct={(a.qty / maxQ) * 100}
                        levels={LEVELS}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td
                  colSpan={3}
                  className="border-t border-border px-4 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70"
                >
                  Bid · Qty · Share
                </td>
              </tr>
              {topBids.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-xs font-mono text-foreground/40">
                    No bids — thin book
                  </td>
                </tr>
              )}
              {topBids.map((b, i) => (
                <tr key={`bid-${b.price}-${i}`}>
                  <td colSpan={3} className="p-0">
                    <DepthRow
                      row={b}
                      side="bid"
                      best={i === 0}
                      cum={cumBid[i]}
                      total={totBid}
                      depthPct={(b.qty / maxQ) * 100}
                      levels={LEVELS}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-border flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-foreground/40">
            <span>
              TOT BID {totBid.toLocaleString("en-IN")} · TOT ASK{" "}
              {totAsk.toLocaleString("en-IN")}
            </span>
            <span className="hidden sm:inline">
              click a row to prefill ticket
            </span>
          </div>
        </>
      )}
    </div>
  );
}
