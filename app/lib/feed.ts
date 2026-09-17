import "server-only";
import { runtimeSettings } from "./adminRuntime";
import { resolveUpstoxKey } from "./upstox";

// ── Upstox v3 market-data feed hub ────────────────────────────────────────
// One WebSocket per server process (shared by every browser tab via SSE).
// Symbols are ref-counted by SSE clients; the upstream subscription set
// follows the union and deltas are sent as clients come and go.

export type FeedDepthLevel = { price: number; qty: number; orders: number };

export type FeedTick = {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number; // previous close (cp)
  volume: number;
  /** Provider's last-trade time (epoch ms) — what staleness is judged on. */
  ts: number;
  /** When THIS process received the tick. Used to rank WS vs REST. */
  receivedAt: number;
  source: "upstox";
  atp?: number;
  tbq?: number;
  tsq?: number;
  oi?: number | null;
  depth?: { buy: FeedDepthLevel[]; sell: FeedDepthLevel[] };
};

type FeedTokenSource = "admin-feed" | "admin-api" | "env" | "none";

type FeedState = {
  streamer: any | null;
  SDK: any | null;
  connected: boolean;
  connecting: boolean;
  lastMessageAt: number;
  lastErrorAt: number;
  lastError: string;
  tokenInUse: string;
  tokenSource: FeedTokenSource;
  refs: Map<string, number>;
  symbolByKey: Map<string, string>;
  keyBySymbol: Map<string, string>;
  subscribedKeys: Set<string>;
  ticks: Map<string, FeedTick>;
  listeners: Set<(ticks: FeedTick[]) => void>;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** Coalescing buffer — the upstream pushes ~6 ticks/sec per symbol. */
  pending: Map<string, FeedTick>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Pre-subscribed symbols with an expiry stamp, used for prefetching: a
   * hovered search result or an opening stock page asks for its symbols now so
   * the socket already holds a price by the time the page renders. Entries drop
   * themselves, so "recently viewed" stays warm without leaking subscriptions.
   */
  touched: Map<string, number>;
  messages: number;
};

const KEY = "__fsFeedHub";

function state(): FeedState {
  const g = globalThis as any;
  if (!g[KEY]) {
    g[KEY] = {
      streamer: null,
      SDK: null,
      connected: false,
      connecting: false,
      lastMessageAt: 0,
      lastErrorAt: 0,
      lastError: "",
      tokenInUse: "",
      tokenSource: "none",
      refs: new Map(),
      symbolByKey: new Map(),
      keyBySymbol: new Map(),
      subscribedKeys: new Set(),
      ticks: new Map(),
      listeners: new Set(),
      retryTimer: null,
      pending: new Map(),
      flushTimer: null,
      touched: new Map(),
      messages: 0,
    } satisfies FeedState;
  }
  return g[KEY];
}

const MAX_SYMBOLS = 200;

// Everything the socket should be subscribed to: live page requests (refs) plus
// un-expired prefetches. Expired prefetches are swept here.
function wantedSymbols(s: FeedState): string[] {
  const now = Date.now();
  const out = new Set<string>(s.refs.keys());
  for (const [sym, expiresAt] of s.touched) {
    if (expiresAt > now) out.add(sym);
    else s.touched.delete(sym);
  }
  return [...out].slice(0, MAX_SYMBOLS);
}

async function pickToken(): Promise<{
  token: string;
  source: FeedTokenSource;
}> {
  try {
    const rs = await runtimeSettings();
    if (rs.feedToken) return { token: rs.feedToken, source: "admin-feed" };
    if (rs.upstoxToken) return { token: rs.upstoxToken, source: "admin-api" };
  } catch {
    /* fall through to env */
  }
  const env = process.env;
  const t =
    env.UPSTOX_FEED_TOKEN ||
    env.UPSTOX_ACCESS_TOKEN ||
    env.UPSTOX_ANALYTICS_TOKEN ||
    "";
  return { token: t, source: t ? "env" : "none" };
}

async function loadSDK(s: FeedState) {
  if (s.SDK) return s.SDK;
  const mod: any = await import("upstox-js-sdk");
  s.SDK = mod?.default ?? mod;
  return s.SDK;
}

function dispose(s: FeedState) {
  try {
    s.streamer?.disconnect?.();
  } catch {
    /* already closed */
  }
  s.streamer = null;
  s.connected = false;
  s.connecting = false;
  s.subscribedKeys.clear();
}

function scheduleRetry(s: FeedState) {
  if (s.retryTimer) return;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = null;
    if (s.refs.size) void connect(s);
  }, 30000);
}

async function connect(s: FeedState) {
  if (s.connected || s.connecting) return;
  const { token, source } = await pickToken();
  s.tokenSource = source;
  if (!token) {
    s.lastError = "no feed token";
    s.lastErrorAt = Date.now();
    return;
  }
  s.connecting = true;
  try {
    const SDK = await loadSDK(s);
    const client = SDK.ApiClient.instance;
    client.authentications["OAUTH2"].accessToken = token;
    s.tokenInUse = token;

    const streamer = new SDK.MarketDataStreamerV3([], "full");
    s.streamer = streamer;

    // Switch OFF the SDK's own auto-reconnect, before any listener is attached.
    //
    // Two defects in upstox-js-sdk 2.31.0 make it unsafe to leave on:
    //
    //   1. `Streamer#_prepareAutoReconnect` attaches a fresh 1s retry interval on
    //      EVERY "close" and only ever clears the most recent one on "open", so
    //      intervals leak for as long as the socket keeps failing.
    //   2. When a retry cycle exhausts its count it calls
    //      `this.streamer.clearSubscriptions()` — but on this class `streamer` is
    //      the MarketDataFeederV3, and `clearSubscriptions` exists only as a
    //      private method of the streamer itself. Every leaked interval therefore
    //      throws a TypeError from inside a timer, once per second, forever.
    //
    // The result is an unhandled-rejection storm that starves the event loop and
    // takes the whole server down whenever the feed cannot connect — which is
    // precisely when the app most needs to stay up. We retry on our own bounded
    // schedule (`scheduleRetry`) anyway, so the SDK's retry is redundant.
    //
    // `autoReconnect(false)` emits AUTO_RECONNECT_STOPPED, which must land before
    // listeners exist or it would tear down the streamer we are about to connect.
    try {
      streamer.autoReconnect?.(false);
    } catch {
      /* older SDK without the switch — scheduleRetry still bounds us */
    }

    streamer.on("open", () => {
      s.connected = true;
      s.connecting = false;
      s.lastError = "";
      // (Re)subscribe the whole wanted set — reconnect wipes upstream state.
      void syncSubscriptions(s);
    });
    streamer.on("message", (data: any) => {
      s.lastMessageAt = Date.now();
      s.messages += 1;
      try {
        const parsed = JSON.parse(String(data));
        ingest(s, parsed);
      } catch (e: any) {
        s.lastError = `decode: ${e?.message || e}`;
        s.lastErrorAt = Date.now();
      }
    });
    streamer.on("error", (e: any) => {
      s.lastError = String(e?.message || e);
      s.lastErrorAt = Date.now();
    });
    streamer.on("close", () => {
      s.connected = false;
      s.connecting = false;
      s.subscribedKeys.clear();
    });
    streamer.on("autoReconnectStopped", () => {
      // SDK gave up — rebuild from scratch after a cooldown.
      s.connected = false;
      s.connecting = false;
      dispose(s);
      scheduleRetry(s);
    });
    await streamer.connect();
    // Safety: if the handshake hangs, reset and retry instead of
    // staying "connecting" forever.
    setTimeout(() => {
      if (!s.connected && s.streamer === streamer) {
        s.connecting = false;
        s.lastError = "connect timeout";
        s.lastErrorAt = Date.now();
        dispose(s);
        scheduleRetry(s);
      }
    }, 20000);
  } catch (e: any) {
    s.connecting = false;
    s.connected = false;
    s.lastError = `connect: ${e?.message || e}`;
    s.lastErrorAt = Date.now();
  }
}

// Keep upstream subscriptions in sync with the wanted union.
async function syncSubscriptions(s: FeedState) {
  if (!s.streamer) return;
  const wanted = wantedSymbols(s);
  // Resolve any unknown symbols to instrument keys first.
  for (const sym of wanted) {
    if (!s.keyBySymbol.has(sym)) {
      try {
        const key = await resolveUpstoxKey(sym);
        if (key) {
          s.keyBySymbol.set(sym, key);
          s.symbolByKey.set(key, sym);
        }
      } catch {
        /* master unavailable — retry next sync */
      }
    }
  }
  const wantKeys = new Set(
    wanted.map((sym) => s.keyBySymbol.get(sym)).filter(Boolean) as string[],
  );
  if (!s.connected) return; // on("open") will re-run this
  const toAdd = [...wantKeys].filter((k) => !s.subscribedKeys.has(k));
  const toDrop = [...s.subscribedKeys].filter((k) => !wantKeys.has(k));
  try {
    if (toAdd.length) {
      s.streamer.subscribe(toAdd, "full");
      for (const k of toAdd) s.subscribedKeys.add(k);
    }
    if (toDrop.length) {
      s.streamer.unsubscribe(toDrop);
      for (const k of toDrop) s.subscribedKeys.delete(k);
    }
  } catch (e: any) {
    s.lastError = `subscribe: ${e?.message || e}`;
    s.lastErrorAt = Date.now();
  }
}

const num = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function ingest(s: FeedState, msg: any) {
  const feeds = msg?.feeds;
  if (!feeds || typeof feeds !== "object") return;
  for (const key of Object.keys(feeds)) {
    const symbol = s.symbolByKey.get(key);
    if (!symbol) continue;
    const f = feeds[key] ?? {};
    const ff = f.fullFeed ?? f;
    const mff = ff?.marketFF ?? {};
    const iff = ff?.indexFF ?? {};
    const ltpc = mff?.ltpc ?? iff?.ltpc ?? f?.ltpc;
    if (!ltpc || !num(ltpc.ltp)) continue;

    const ohlcRows: any[] =
      mff?.marketOHLC?.ohlc ?? iff?.marketOHLC?.ohlc ?? [];
    const day = ohlcRows.find((r) => r?.interval === "1d") ?? {};
    const bidAsk: any[] = mff?.marketLevel?.bidAskQuote ?? [];
    const buy: FeedDepthLevel[] = [];
    const sell: FeedDepthLevel[] = [];
    for (const row of bidAsk) {
      if (!row) continue;
      if (num(row.bidP) > 0 && num(row.bidQ) > 0)
        buy.push({
          price: num(row.bidP),
          qty: num(row.bidQ),
          orders: num(row.bidO),
        });
      if (num(row.askP) > 0 && num(row.askQ) > 0)
        sell.push({
          price: num(row.askP),
          qty: num(row.askQ),
          orders: num(row.askO),
        });
    }
    buy.sort((a, b) => b.price - a.price);
    sell.sort((a, b) => a.price - b.price);

    const prev: FeedTick | undefined = s.ticks.get(symbol);
    const tick: FeedTick = {
      symbol,
      ltp: num(ltpc.ltp),
      open: num(day.open) || prev?.open || 0,
      high: num(day.high) || prev?.high || 0,
      low: num(day.low) || prev?.low || 0,
      close: num(ltpc.cp) || prev?.close || 0,
      volume: num(mff?.vtt) || num(day.vol) || prev?.volume || 0,
      ts: num(ltpc.ltt) || Date.now(),
      receivedAt: Date.now(),
      source: "upstox",
      atp: num(mff?.atp) || undefined,
      tbq: num(mff?.tbq) || undefined,
      tsq: num(mff?.tsq) || undefined,
      oi: mff?.oi ?? iff?.oi ?? null,
      depth: buy.length || sell.length ? { buy, sell } : prev?.depth,
    };
    s.ticks.set(symbol, tick);
    s.pending.set(symbol, tick);
  }
  if (s.pending.size) scheduleFlush(s);
}

// Upstream pushes several ticks per second per symbol. Coalescing stops the
// SSE fan-out and the React tree re-rendering once per upstream packet:
// listeners get one batch per FLUSH_MS carrying each symbol's latest value.
const FLUSH_MS = 150;

function scheduleFlush(s: FeedState) {
  if (s.flushTimer) return;
  s.flushTimer = setTimeout(() => {
    s.flushTimer = null;
    const batch = [...s.pending.values()];
    s.pending.clear();
    if (!batch.length) return;
    for (const l of s.listeners) {
      try {
        l(batch);
      } catch {
        /* listener died — route cleanup removes them */
      }
    }
  }, FLUSH_MS);
}

// SSE route: acquire symbols (ref-counted) and subscribe to updates.
export function feedAcquire(symbols: string[]): () => void {
  const s = state();
  const uniq = [...new Set(symbols.map((x) => x.trim().toUpperCase()))]
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
  for (const sym of uniq) s.refs.set(sym, (s.refs.get(sym) || 0) + 1);
  void (async () => {
    await connect(s).catch(() => {});
    await syncSubscriptions(s).catch(() => {});
  })();
  return () => {
    for (const sym of uniq) {
      const n = (s.refs.get(sym) || 1) - 1;
      if (n <= 0) s.refs.delete(sym);
      else s.refs.set(sym, n);
    }
    void syncSubscriptions(s).catch(() => {});
  };
}

export function feedSubscribe(cb: (ticks: FeedTick[]) => void): () => void {
  const s = state();
  s.listeners.add(cb);
  return () => {
    s.listeners.delete(cb);
  };
}

export function feedSnapshot(symbols: string[]): FeedTick[] {
  const s = state();
  const mine = new Set(symbols.map((x) => x.toUpperCase()));
  return [...s.ticks.values()].filter((t) => mine.has(t.symbol));
}

export function feedTick(symbol: string): FeedTick | undefined {
  return state().ticks.get(String(symbol).toUpperCase());
}

// Newest streamed value for a symbol, if the socket delivered it recently.
// REST routes consult this FIRST so a client can never be handed the delayed
// snapshot when the live socket already knows a better price.
export function feedFresh(
  symbol: string,
  maxAgeMs = 300_000,
): FeedTick | undefined {
  const t = state().ticks.get(String(symbol || "").toUpperCase());
  if (!t) return undefined;
  return Date.now() - t.receivedAt <= maxAgeMs ? t : undefined;
}

// Keep the upstream socket connected even with no browser attached, so the
// first page load already has live prices and REST routes have something
// fresh to serve. Called from request handlers (never at import time, so
// builds stay side-effect free).
let warmStarted = false;
export function feedWarm(): void {
  if (warmStarted) return;
  warmStarted = true;
  void (async () => {
    try {
      const rs = await runtimeSettings();
      const base = [...new Set([...(rs.tape || []), ...(rs.rail || [])])]
        .map((x) => String(x).trim().toUpperCase())
        .filter(Boolean);
      if (!base.length) return;
      // Deliberately never released — this keeps the feed permanently hot.
      feedAcquire(base);
    } catch {
      warmStarted = false; // settings not readable yet — retry on next request
    }
  })();
}

let touchSweep: ReturnType<typeof setTimeout> | null = null;

// Drop prefetched symbols whose hold has lapsed, then resync the upstream
// subscription set. Re-arms itself while anything is still held.
function scheduleTouchSweep(s: FeedState) {
  if (touchSweep) return;
  touchSweep = setTimeout(() => {
    touchSweep = null;
    const now = Date.now();
    let dropped = false;
    for (const [sym, expiresAt] of s.touched) {
      if (expiresAt <= now) {
        s.touched.delete(sym);
        dropped = true;
      }
    }
    if (dropped) void syncSubscriptions(s).catch(() => {});
    if (s.touched.size) scheduleTouchSweep(s);
  }, 30_000);
}

/**
 * Subscribe symbols ahead of demand and release them automatically.
 *
 * Opening a stock page costs ~1.4s today: the browser has to rebuild its SSE
 * stream (800ms debounce) before the server even learns the symbol. Touching it
 * first — on hover, on search, or as the page mounts — means the socket already
 * holds a price, so the page renders live instead of waiting.
 *
 * Returns how many symbols were touched. Costs no upstream call unless the
 * symbol is genuinely new.
 */
export function feedTouch(symbols: string[], holdMs = 600_000): number {
  const s = state();
  const uniq = [...new Set(symbols.map((x) => String(x).trim().toUpperCase()))]
    .filter(Boolean)
    .slice(0, 50);
  if (!uniq.length) return 0;
  const expiresAt = Date.now() + holdMs;
  for (const sym of uniq) {
    // Keep the later expiry if it is already held.
    const cur = s.touched.get(sym);
    s.touched.set(sym, cur && cur > expiresAt ? cur : expiresAt);
  }
  void (async () => {
    await connect(s).catch(() => {});
    await syncSubscriptions(s).catch(() => {});
  })();
  scheduleTouchSweep(s);
  return uniq.length;
}

export function feedHealth() {
  const s = state();
  return {
    connected: s.connected,
    connecting: s.connecting,
    tokenSource: s.tokenSource,
    tokenSet: Boolean(s.tokenInUse),
    subscribed: s.subscribedKeys.size,
    wanted: s.refs.size,
    prefetched: s.touched.size,
    listeners: s.listeners.size,
    messages: s.messages,
    lastMessageAt: s.lastMessageAt || null,
    lastMessageAgeMs: s.lastMessageAt ? Date.now() - s.lastMessageAt : null,
    ticks: s.ticks.size,
    lastError: s.lastError || null,
    lastErrorAt: s.lastErrorAt || null,
  };
}
