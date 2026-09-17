"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { apiURL } from "@/app/components/apiURL";
import { getTick, subscribeTicks } from "@/app/hooks/useLiveTicks";

export type BookRow = { price: number; qty: number; orders?: number };

function toRows(v: any): BookRow[] {
  const arr = Array.isArray(v) ? v : v ? Object.values(v) : [];
  return (arr as any[])
    .map((b) => ({
      price: Number(b?.price ?? (Array.isArray(b) ? b[0] : 0) ?? 0),
      qty: Number(b?.qty ?? (Array.isArray(b) ? b[1] : 0) ?? b?.quantity ?? 0),
      orders: Number(b?.orders ?? 0) || undefined,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.price) &&
        Number.isFinite(r.qty) &&
        r.qty >= 0 &&
        r.price > 0,
    );
}

// Single polling source for both depth views (was two separate fetchers).
export function useOrderBook(symbol: string, intervalMs = 5000) {
  const [bids, setBids] = useState<BookRow[]>([]);
  const [asks, setAsks] = useState<BookRow[]>([]);
  const [tsMillis, setTsMillis] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<"feed" | "upstox" | "legacy" | null>(
    null,
  );
  const fails = useRef(0);
  const lastFeed = useRef(0);

  const load = useCallback(async () => {
    if (!symbol) return;
    // Feed depth is fresher — skip REST while it's flowing.
    if (Date.now() - lastFeed.current < 20000) return;
    // 1) Live depth from Upstox (rides the shared quote cache).
    try {
      const r = await axios.post("/api/market/fullquote", {
        symbol: decodeURIComponent(symbol),
      });
      const depth = r.data?.quote?.depth;
      const buy = toRows(depth?.buy).sort((a, b) => b.price - a.price);
      const sell = toRows(depth?.sell).sort((a, b) => a.price - b.price);
      if (!buy.length && !sell.length) throw new Error("empty depth");
      setBids(buy);
      setAsks(sell);
      setTsMillis(Date.now());
      setSource("upstox");
      setLive(true);
      fails.current = 0;
      setLoading(false);
      return;
    } catch {
      /* fall back to the /getOrderBook route below */
    }
    // 2) /api/v1/getOrderBook — the older depth payload, still served locally.
    try {
      const r = await axios.post(`${apiURL}/getOrderBook`, { symbol });
      const buy = toRows(r.data?.orderData?.buyBook).sort(
        (a, b) => b.price - a.price,
      );
      const sell = toRows(r.data?.orderData?.sellBook).sort(
        (a, b) => a.price - b.price,
      );
      setBids(buy);
      setAsks(sell);
      const ts = r.data?.orderData?.tsInMillis;
      setTsMillis(typeof ts === "number" && ts > 0 ? ts : Date.now());
      setSource("legacy");
      fails.current = 0;
      setLive(true);
    } catch {
      fails.current += 1;
      if (fails.current >= 2) setLive(false);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    setLoading(true);
    lastFeed.current = 0;
    // Tick-level depth straight from the WebSocket feed store.
    function fromFeed() {
      const t = getTick(decodeURIComponent(symbol));
      const d = t?.depth;
      if (!d || (!d.buy?.length && !d.sell?.length)) return;
      setBids(toRows(d.buy).sort((a, b) => b.price - a.price));
      setAsks(toRows(d.sell).sort((a, b) => a.price - b.price));
      setTsMillis(t?.ts ?? Date.now());
      setSource("feed");
      setLive(true);
      setLoading(false);
      fails.current = 0;
      lastFeed.current = Date.now();
    }
    fromFeed();
    const unsub = subscribeTicks(fromFeed);
    load(); // cold-start seed / fallback
    const id = setInterval(() => {
      if (Date.now() - lastFeed.current < 20000) return; // feed covering
      load();
    }, intervalMs);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [load, intervalMs, symbol]);

  return { bids, asks, tsMillis, loading, live, source, refresh: load };
}

export const DEPTH_PICK_EVENT = "fs:depth-pick";

export function pickDepth(price: number, side: "BUY" | "SELL", qty?: number) {
  window.dispatchEvent(
    new CustomEvent(DEPTH_PICK_EVENT, { detail: { price, side, qty } }),
  );
}
