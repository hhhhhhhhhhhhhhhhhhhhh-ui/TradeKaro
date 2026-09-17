"use client";

// Fire-and-forget price prefetch.
//
// Opening a fresh stock costs ~1.4s today, because the browser has to rebuild
// its SSE stream (an 800ms debounce) before the server learns the symbol. This
// tells the server early — on hover, or as a page mounts — so the socket is
// already streaming by the time the page renders.
//
// Everything here is best-effort: failures are silent, calls are batched into
// one request, and a symbol is not re-asked for within ASK_TTL.

const ASK_TTL = 120_000;
const BATCH_MS = 60;
const MAX_PER_CALL = 40;

const asked = new Map<string, number>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = [...queue].slice(0, MAX_PER_CALL);
  queue = new Set();
  if (!batch.length) return;
  void fetch("/api/market/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: batch }),
    keepalive: true,
  }).catch(() => {
    /* prefetch is optional — the real fetch still happens */
  });
}

/**
 * Ask the server to start streaming these symbols now.
 * Safe to call on every hover and from any mount effect.
 */
export function warmPrices(symbols: string[] | string): void {
  if (typeof window === "undefined") return;
  const list = (Array.isArray(symbols) ? symbols : [symbols])
    .map((s) =>
      String(s || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  if (!list.length) return;

  const now = Date.now();
  let added = false;
  for (const sym of list) {
    if (now - (asked.get(sym) || 0) < ASK_TTL) continue;
    asked.set(sym, now);
    queue.add(sym);
    added = true;
  }
  if (!added || timer) return;
  // Tiny window so typing in a search box collapses into one request.
  timer = setTimeout(flush, BATCH_MS);
}
