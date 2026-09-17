"use client";
import { useEffect, useState } from "react";
import { warmPrices } from "@/app/lib/warmPrices";

export type Tick = {
  symbol: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  ts?: number;
  /** Age of the provider last-trade time, stamped when the store is painted. */
  ageMs?: number;
  /** true = pushed by the live socket; false = served from the REST snapshot. */
  streamed?: boolean;
  source: "upstox" | "stale";
  atp?: number;
  tbq?: number;
  tsq?: number;
  oi?: number | null;
  depth?: {
    buy: { price: number; qty: number; orders?: number }[];
    sell: { price: number; qty: number; orders?: number }[];
  };
};

// ── Shared client tick store ──
// Before: every useLiveTicks instance ran its own setInterval + fetch,
// so TickerTape + StatusBar + MarketStatusRow + WatchlistRail + page hooks
// fired 4-5 parallel POST /api/market/quote every 5-8s.
// Now: one global poller fetches the UNION of wanted symbols.
// Interval + hidden-tab pause follow the admin panel (/api/admin/public).
const store: Record<string, Tick> = {};
let liveFlag = false;
// When each symbol last arrived over the live socket. A REST poll must never
// overwrite a symbol the socket is actively pushing — that is exactly how the
// delayed snapshot used to clobber live prices.
const streamedAt: Record<string, number> = {};
const STREAM_TRUST_MS = 20000;
const STREAM_LIVE_MS = 20000;
let lastFetch = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let pollMs = 8000;
let hiddenPause = true;
const listeners = new Set<() => void>();
const wanted = new Map<string, number>(); // symbol -> refcount

// ── SSE realtime stream (one EventSource per tab) ──
// Ticks are pushed from /api/market/stream; REST polling stays as the
// automatic fallback whenever the stream is down or stale.
const SSE_CAP = 100;
let sse: EventSource | null = null;
let sseKey = "";
let sseTimer: ReturnType<typeof setTimeout> | null = null;
let sseHealthy = false;
let lastSseAt = 0;
// Whether the server's upstream socket is actually connected. Ticks stop at the
// closing bell, so recency alone cannot tell "feed broken" from "market shut".
let feedConnected = false;

// IST market hours (09:15–15:30, Mon–Fri). India has no DST, so this is a fixed
// +5:30 offset. Holidays are ignored on purpose: on a holiday the socket is up
// and quiet, which is exactly the case we want to report as LIVE not DELAYED.
function marketOpenNow(): boolean {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 555 && mins <= 930;
}

function onSseMessage(e: MessageEvent) {
  try {
    const items = JSON.parse(e.data) as Tick[];
    let any = false;
    for (const t of items) {
      if (!t?.symbol || !t.ltp) continue;
      // Socket ticks are authoritative: they overwrite anything, including a
      // REST snapshot fetched a moment earlier.
      store[t.symbol] = { ...t, streamed: true };
      streamedAt[t.symbol] = Date.now();
      any = true;
    }
    if (any) {
      liveFlag = true;
      sseHealthy = true;
      lastSseAt = Date.now();
      emitSoon();
    }
  } catch {
    /* malformed frame — keep previous */
  }
}

function syncSSE() {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    return;
  const symbols = [...wanted.keys()].slice(0, SSE_CAP);
  if (!symbols.length) {
    if (sse) sse.close();
    sse = null;
    sseKey = "";
    sseHealthy = false;
    return;
  }
  const key = symbols.join(",");
  if (key === sseKey && sse) return;
  if (sseTimer) clearTimeout(sseTimer);
  sseTimer = setTimeout(() => {
    sseTimer = null;
    if (sse) sse.close();
    sse = new EventSource(
      `/api/market/stream?symbols=${encodeURIComponent(key)}`,
    );
    sseKey = key;
    sse.onopen = () => {
      sseHealthy = true;
    };
    sse.onerror = () => {
      // EventSource retries by itself; polling covers the gap meanwhile.
      sseHealthy = false;
      feedConnected = false;
    };
    sse.addEventListener("ticks", onSseMessage);
    sse.addEventListener("hello", (e) => {
      sseHealthy = true;
      try {
        const j = JSON.parse((e as MessageEvent).data);
        if (typeof j?.feed?.connected === "boolean")
          feedConnected = j.feed.connected;
      } catch {
        /* hello without a payload — sseHealthy alone is enough */
      }
      emit();
    });
    // Periodic health from the server heartbeat (every 15s).
    sse.addEventListener("feed", (e) => {
      try {
        const j = JSON.parse((e as MessageEvent).data);
        if (typeof j?.feed?.connected === "boolean") {
          feedConnected = j.feed.connected;
          emit();
        }
      } catch {
        /* ignore malformed health frame */
      }
    });
  }, 800);
}

// Admin can change the poll interval live — pull it in the background.
if (typeof window !== "undefined") {
  fetch("/api/admin/public", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return;
      if (Number.isFinite(j.clientPollMs))
        pollMs = Math.max(2000, Math.min(60000, j.clientPollMs));
      if (typeof j.hiddenTabPause === "boolean") hiddenPause = j.hiddenTabPause;
      restartTimer();
    })
    .catch(() => {});
  setInterval(() => {
    fetch("/api/admin/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const next = Number.isFinite(j.clientPollMs)
          ? Math.max(2000, Math.min(60000, j.clientPollMs))
          : pollMs;
        if (next !== pollMs) {
          pollMs = next;
          restartTimer();
        }
        if (typeof j.hiddenTabPause === "boolean")
          hiddenPause = j.hiddenTabPause;
      })
      .catch(() => {});
  }, 60000);
}

function emit() {
  for (const l of listeners) l();
}

// Upstream pushes several ticks per second. Coalescing keeps a fast feed
// smooth — one React pass per window instead of one per upstream packet.
let emitTimer: ReturnType<typeof setTimeout> | null = null;
function emitSoon() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emit();
  }, 150);
}

async function fetchUnion() {
  if (!wanted.size) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const all = [...wanted.keys()];
      // /api/market/quote handles ≤10 per call — chunk larger unions.
      for (let i = 0; i < all.length; i += 10) {
        const chunk = all.slice(i, i + 10);
        const r = await fetch("/api/market/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: chunk }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        for (const t of j.ticks || []) {
          if (!t?.symbol || !t.ltp) continue;
          const socketAge = Date.now() - (streamedAt[t.symbol] || 0);
          // The socket is live for this symbol — its price already beats this
          // snapshot, so accepting the snapshot would move the price BACKWARD.
          if (streamedAt[t.symbol] && socketAge < STREAM_TRUST_MS) continue;
          const prev = store[t.symbol];
          // Never go backwards on provider time either.
          if (prev && t.ts && prev.ts && prev.ts > t.ts) continue;
          // The server marks values it served straight off the socket, so a
          // REST fetch is not automatically "delayed" — trust that flag.
          const isStreamed = t.streamed === true;
          store[t.symbol] = { ...t, streamed: isStreamed };
          if (isStreamed) streamedAt[t.symbol] = Date.now();
        }
      }
      lastFetch = Date.now();
      emitSoon();
    } catch {
      /* keep stale */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function ensureTimer() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    if (hiddenPause && document.hidden) return; // pause when tab hidden
    if (!wanted.size) return;
    // Self-heal: if the stream is missing or its socket closed, rebuild it.
    // Without this a single dropped connection left the tab on REST forever.
    if (!sse || sse.readyState === EventSource.CLOSED) {
      if (sse) sse.close();
      sse = null;
      sseKey = "";
      sseHealthy = false;
      syncSSE();
    }
    const streamOk = sseHealthy && Date.now() - lastSseAt < STREAM_LIVE_MS;
    // Re-paint even when nothing ticked, so ageMs / live stay truthful.
    if (streamOk) emit();
    // Socket is healthy and covers every wanted symbol → no REST needed.
    if (streamOk && wanted.size <= SSE_CAP) return;
    fetchUnion();
  }, pollMs);
}

function restartTimer() {
  if (typeof window === "undefined") return;
  if (timer) clearInterval(timer);
  timer = null;
  ensureTimer();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Read the latest tick for a symbol (feed or REST — whoever wrote last).
export function getTick(symbol: string): Tick | undefined {
  return store[String(symbol || "").toUpperCase()];
}

// Subscribe to any store change (used by the depth ladder).
export function subscribeTicks(fn: () => void): () => void {
  return subscribe(fn);
}

export function useLiveTicks(symbols: string[], _intervalMs = 8000) {
  const symKey = symbols
    .map((s) => s.toUpperCase())
    .sort()
    .join(",");
  const [snap, setSnap] = useState<Record<string, Tick>>({});
  const [live, setLive] = useState(liveFlag);

  useEffect(() => {
    const list = symKey.split(",").filter(Boolean);
    for (const s of list) wanted.set(s, (wanted.get(s) || 0) + 1);
    // Tell the server we want these now. The SSE stream below takes ~800ms to
    // rebuild, so without this a freshly opened symbol has no price waiting.
    warmPrices(list);
    ensureTimer();
    syncSSE();
    function paint() {
      const out: Record<string, Tick> = {};
      const now = Date.now();
      for (const s of list) {
        const t = store[s];
        if (!t) continue;
        out[s] = t.ts ? { ...t, ageMs: Math.max(0, now - t.ts) } : t;
      }
      setSnap(out);
      // "live" means the socket itself is delivering. After the closing bell no
      // ticks arrive, so fall back to the socket's own connected flag there —
      // otherwise every evening would read DELAYED with a healthy feed.
      const recent = sseHealthy && now - lastSseAt < STREAM_LIVE_MS;
      setLive(feedConnected ? recent || !marketOpenNow() : recent);
    }
    paint();
    // Immediate REST seed only if cache older than 5s and stream cold.
    if (!sseHealthy && Date.now() - lastFetch > 5000) fetchUnion().then(paint);
    const unsub = subscribe(paint);
    return () => {
      unsub();
      for (const s of list) {
        const n = (wanted.get(s) || 1) - 1;
        if (n <= 0) wanted.delete(s);
        else wanted.set(s, n);
      }
      syncSSE();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symKey]);

  return { ticks: snap, live };
}
