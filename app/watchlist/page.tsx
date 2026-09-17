"use client";
import { useCallback, useEffect, useState } from "react";
import WatchlistScrip from "./components/WatchlistScrip";
import { apiURL } from "../components/apiURL";
import axios from "axios";
import { getCookie } from "cookies-next";
import { NavTransition } from "../components/navbar/NavTransition";
import MultiWatchlists from "../components/MultiWatchlists";
import BasketPanel from "../components/BasketPanel";
import SymbolSearch from "../components/SymbolSearch";
import { useLiveTicks } from "../hooks/useLiveTicks";
import { sileo } from "sileo";

export default function WatchlistPage() {
  const [watchlistData, setWatchlistData] = useState<any>({});
  const token = getCookie("token") as string | undefined;
  const [loading, setLoading] = useState(true);

  const loadWatchlist = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await axios({
        method: "post",
        url: apiURL + "/getWatchList",
        headers: { Authorization: "Bearer " + token },
      });
      setWatchlistData(data?.data || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  function handleRemove(symbol: string) {
    setWatchlistData((prev: any) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }

  // The same endpoint the stock page uses, so "already there" stays a 409 toast
  // rather than a silent no-op. Reloading keeps the server as the source of
  // truth for the list.
  async function addToWatchlist(symbol: string) {
    if (!token) {
      sileo.error({ title: "Sign in to track stocks" });
      return;
    }
    try {
      await axios({
        method: "post",
        url: apiURL + "/transaction/addWatchlist",
        headers: { Authorization: "Bearer " + token },
        data: { scrip: symbol },
      });
      sileo.success({ title: `${symbol} added to watchlist` });
      await loadWatchlist();
    } catch (err: any) {
      if (err?.response?.status === 409)
        sileo.error({ title: `${symbol} is already in your watchlist` });
      else sileo.error({ title: `Could not add ${symbol}` });
    }
  }

  const watchlistItems = Object.keys(watchlistData || {});
  // useLiveTicks chunks the union into ≤10-symbol quote calls internally,
  // so the whole watchlist stays live (no more 10-symbol cap).
  const { ticks } = useLiveTicks(watchlistItems, 5000);
  const ltps: Record<string, number> = {};
  for (const k of Object.keys(ticks)) ltps[k] = ticks[k].ltp;
  const isEmpty = !loading && watchlistItems.length === 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Watchlist
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Live prices for the scrips you track.
          </p>
        </div>

        {/* Add straight from here — no detour to a stock page. */}
        <div className="mb-6 max-w-2xl">
          <SymbolSearch
            onAdd={addToWatchlist}
            placeholder="Search a stock to add — e.g. RELIANCE, INFY, TATAMOTORS"
          />
        </div>

        {loading ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="border border-border bg-card p-6 hover:bg-muted transition-colors"
              >
                <div className="h-3 w-20 bg-foreground/10 mb-3"></div>
                <div className="h-4 w-32 bg-foreground/10 mb-4"></div>
                <div className="h-7 w-24 bg-foreground/10 mb-1"></div>
                <div className="h-3 w-16 bg-foreground/10 mb-6"></div>
                <div className="h-9 w-full bg-foreground/10"></div>
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <div className="py-16 text-center border border-border bg-card">
            <div className="max-w-lg mx-auto px-6">
              <h2 className="font-mono text-xl font-bold mb-3 text-foreground">
                YOUR WATCHLIST IS EMPTY
              </h2>
              <p className="text-[13px] text-foreground/70 mb-6">
                Search for a stock above and hit ADD, or browse the market and
                add from any scrip page.
              </p>
              <div className="mx-auto max-w-md text-left">
                <SymbolSearch
                  onAdd={addToWatchlist}
                  placeholder="Type a symbol or company name…"
                />
              </div>
              <NavTransition
                href="/stocks"
                className="mt-6 inline-block px-6 py-3 text-background bg-foreground hover:bg-foreground/90 transition-colors text-[12px] font-mono border border-foreground"
              >
                BROWSE STOCKS
              </NavTransition>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <MultiWatchlists />
            <BasketPanel symbols={watchlistItems} ltps={ltps} />
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {watchlistItems.map((key: any) => {
                const scrip = watchlistData[key];
                return (
                  <WatchlistScrip
                    key={key}
                    scrip={scrip}
                    onRemove={handleRemove}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
