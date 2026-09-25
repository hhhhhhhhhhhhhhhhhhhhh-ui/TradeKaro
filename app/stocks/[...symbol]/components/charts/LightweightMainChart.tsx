"use client";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/app/components/theme/ThemeProvider";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { getTrades } from "@/app/lib/trading";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type TF = "1m" | "5m" | "15m" | "day" | "week";
type CType = "candles" | "line" | "area" | "ha";

const TFS: TF[] = ["1m", "5m", "15m", "day", "week"];
const TYPES: { id: CType; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "ha", label: "Heikin" },
];

function sma(vals: number[], n: number) {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(vals: number[], n: number) {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

function vwap(candles: Candle[]) {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let pv = 0;
  let v = 0;
  let day = "";
  for (let i = 0; i < candles.length; i++) {
    const d = new Date(candles[i].time * 1000).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      pv = 0;
      v = 0;
    }
    const typ = (candles[i].high + candles[i].low + candles[i].close) / 3;
    pv += typ * candles[i].volume;
    v += candles[i].volume;
    out[i] = v > 0 ? pv / v : candles[i].close;
  }
  return out;
}

function rsi(closes: number[], n = 14) {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (i <= n) {
      if (ch > 0) gain += ch;
      else loss -= ch;
      if (i === n) {
        gain /= n;
        loss /= n;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

function heikin(candles: Candle[]) {
  let po = candles[0]?.open ?? 0;
  let pc = candles[0]?.close ?? 0;
  return candles.map((c) => {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = (po + pc) / 2;
    po = open;
    pc = close;
    return {
      time: c.time,
      open,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      close,
    };
  });
}

// Forming Heikin-Ashi bar from raw OHLC + previous HA close.
function haOf(bar: Candle, prev: { open: number; close: number } | null) {
  const close = (bar.open + bar.high + bar.low + bar.close) / 4;
  const open = prev ? (prev.open + prev.close) / 2 : bar.open;
  return {
    time: bar.time as any,
    open,
    close,
    high: Math.max(bar.high, open, close),
    low: Math.min(bar.low, open, close),
  };
}

function loadPref<T>(key: string, fb: T): T {
  try {
    const v = localStorage.getItem(key);
    return v != null ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}

// India has no DST, so IST is a fixed +5:30.
const IST_MS = 5.5 * 3600 * 1000;

/** IST calendar date — the value that flips when a new session begins. */
const istSessionDate = (ms: number) =>
  new Date(ms + IST_MS).toISOString().slice(0, 10);

/** Intraday bucket width in seconds; 0 for day/week. */
const intraStep = (tf: TF) =>
  tf === "1m" ? 60 : tf === "5m" ? 300 : tf === "15m" ? 900 : 0;

/** IST midnight (epoch seconds) for an instant's IST calendar date. */
function istDaySec(ms: number): number {
  const d = new Date(ms + IST_MS);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 -
      IST_MS / 1000,
  );
}

/** Monday IST midnight (epoch seconds) for the week containing an instant. */
function istWeekSec(ms: number): number {
  const d = new Date(ms + IST_MS);
  const sinceMonday = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return Math.floor(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() - sinceMonday,
    ) /
      1000 -
      IST_MS / 1000,
  );
}

/**
 * The candle bucket a tick belongs to, in seconds — matching the convention
 * the candles route emits, so a live bar lands exactly on an existing one.
 *
 * Daily bars are stamped at IST midnight and weekly bars at the Monday IST
 * midnight (verified against Upstox), so a plain UTC day floor would be 5h30m
 * out and never line up.
 */
function tickBucket(tf: TF, tickMs: number): number {
  if (tf === "1m") return Math.floor(tickMs / 60000) * 60;
  if (tf === "5m") return Math.floor(tickMs / 300000) * 300;
  if (tf === "15m") return Math.floor(tickMs / 900000) * 900;
  if (tf === "day") return istDaySec(tickMs);
  if (tf === "week") return istWeekSec(tickMs);
  return 0;
}

// Pro chart: Upstox OHLC for every scrip + local indicators +
// real trade markers with P&L + NIFTY compare + saved prefs.
export default function LightweightMainChart({ symbol }: { symbol: string }) {
  const sym = String(symbol || "").toUpperCase();
  const wrapRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const { chartDefaults } = usePublicConfig();
  const { ticks } = useLiveTicks([sym], 8000);
  const tick = ticks[sym];
  const ltp = tick?.ltp ?? 0;
  const [tf, setTf] = useState<TF>(() =>
    typeof window !== "undefined"
      ? loadPref<TF>("fs-chart-tf", (chartDefaults?.tf as TF) || "day")
      : "day",
  );
  const [ctype, setCtype] = useState<CType>(() =>
    typeof window !== "undefined"
      ? loadPref<CType>(
          "fs-chart-type",
          (chartDefaults?.type as CType) || "candles",
        )
      : "candles",
  );
  const [inds, setInds] = useState(() =>
    typeof window !== "undefined"
      ? loadPref("fs-chart-inds", {
          sma: chartDefaults?.sma ?? true,
          ema: chartDefaults?.ema ?? false,
          vwap: chartDefaults?.vwap ?? false,
          rsi: chartDefaults?.rsi ?? false,
        })
      : { sma: true, ema: false, vwap: false, rsi: false },
  );
  const [compare, setCompare] = useState(
    () =>
      typeof window !== "undefined" &&
      (localStorage.getItem("fs-chart-compare") ??
        (chartDefaults?.compare ? "1" : "0")) === "1",
  );
  const [candles, setCandles] = useState<Candle[]>([]);
  const [nifty, setNifty] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tradeTick, setTradeTick] = useState(0);
  const [hover, setHover] = useState<Candle | null>(null);
  // Bumped to force a candle re-fetch without touching the timeframe.
  const [reloadKey, setReloadKey] = useState(0);
  const liveRef = useRef<{
    series: any;
    volSeries: any;
    lastTime: number;
    kind: CType;
    bar: Candle | null;
    haPrev: { open: number; close: number } | null;
    lastVol: number | null;
  } | null>(null);

  // lightweight-charts is loaded once up front. The rebuild effect used to
  // `await import(...)` on every data change, which yields a frame between
  // tearing the old chart down and building the new one -- a blank flash.
  const lwcRef = useRef<any>(null);
  const [lwcReady, setLwcReady] = useState(false);

  // Where the user was looking. Captured before a rebuild and restored after,
  // so refreshing the data no longer yanks a zoomed-in view to realtime.
  const viewRef = useRef<{
    from: number;
    to: number;
    atRealtime: boolean;
  } | null>(null);
  // The restored view is only valid for the same symbol+timeframe. A new
  // symbol is a fresh context, so it should open at realtime rather than
  // inherit the previous scrip's zoom.
  const viewKeyRef = useRef("");
  // Which symbol+timeframe the candle data currently belongs to. Lets a
  // background refresh be told apart from a genuine context change.
  const loadedKeyRef = useRef("");

  // Bucket we owe the server a reconciliation fetch for (see the live effect).
  const reconcilingRef = useRef(0);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let dead = false;
    import("lightweight-charts").then((m) => {
      if (dead) return;
      lwcRef.current = m;
      setLwcReady(true);
    });
    return () => {
      dead = true;
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("fs-chart-tf", JSON.stringify(tf));
  }, [tf]);
  useEffect(() => {
    localStorage.setItem("fs-chart-type", JSON.stringify(ctype));
  }, [ctype]);
  useEffect(() => {
    localStorage.setItem("fs-chart-inds", JSON.stringify(inds));
  }, [inds]);
  useEffect(() => {
    localStorage.setItem("fs-chart-compare", compare ? "1" : "0");
  }, [compare]);

  useEffect(() => {
    let dead = false;
    // Only the FIRST fetch for a given context shows the loading state. A
    // background refresh that set `loading` would hit the early return at the
    // bottom of this component, which unmounts the chart's host element while
    // the chart instance is still alive. That both flashes "LOADING…" on every
    // poll and makes lightweight-charts throw "Object is disposed" from its
    // next paint.
    const key = `${sym}|${tf}|${compare ? 1 : 0}`;
    const first = loadedKeyRef.current !== key;
    if (first) {
      setLoading(true);
      setErr("");
    }
    const body = (s: string) =>
      fetch("/api/market/candles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: s, interval: tf }),
      }).then((r) => r.json());
    Promise.all([body(sym), compare ? body("NIFTY") : Promise.resolve(null)])
      .then(([j, nj]) => {
        if (dead) return;
        const norm = (rows: any[]): Candle[] =>
          (rows ?? [])
            .map((c: any) =>
              Array.isArray(c)
                ? {
                    // Upstox row: [ts, open, high, low, close, volume, oi].
                    // high/low/close used to all be set to the OPEN, which
                    // would have drawn flat candles, and the timestamp was
                    // divided as if it were epoch-ms when Upstox sends ISO.
                    time: Math.floor(
                      (typeof c[0] === "number"
                        ? c[0] < 1e12
                          ? c[0] * 1000
                          : c[0]
                        : Date.parse(c[0])) / 1000,
                    ),
                    open: Number(c[1]),
                    high: Number(c[2]),
                    low: Number(c[3]),
                    close: Number(c[4]),
                    volume: Number(c[5] ?? 0),
                  }
                : c,
            )
            .filter((c: Candle) => c?.time && c?.close > 0)
            .sort((a: Candle, b: Candle) => a.time - b.time);
        const rows = norm(j?.candles);
        setCandles(rows);
        setNifty(nj ? norm(nj?.candles) : []);
        if (!rows.length) {
          // Never blank out a chart that is already showing good data; a
          // transient empty response from a background refresh is not a reason
          // to tear it down.
          if (first) setErr(j?.error || "No candles for this scrip");
          return;
        }
        setCandles(rows);
        setNifty(nj ? norm(nj?.candles) : []);
      })
      .catch((e) => {
        if (!dead && first) setErr(e?.message || "Chart failed");
      })
      .finally(() => {
        if (dead) return;
        loadedKeyRef.current = key;
        setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [sym, tf, compare, reloadKey]);

  // Candles are fetched once per (symbol, timeframe) — cheap, and enough while
  // the live tick keeps the forming bar current. But that leaves two gaps:
  // a chart left open across the session boundary never picks up the new
  // session, and one hidden for a while never fills the bars it missed. Both
  // re-fetch rather than polling, so the user's zoom and pan survive.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        hiddenAt = 0;
        setReloadKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    let session = istSessionDate(Date.now());
    const t = setInterval(() => {
      if (document.hidden) return;
      const next = istSessionDate(Date.now());
      if (next !== session) {
        session = next;
        setReloadKey((k) => k + 1);
      }
    }, 30_000);

    // Steady refresh, so a dropped socket or a bar missed while backgrounded
    // heals on its own instead of waiting for the user to refocus. Safe now
    // that a rebuild restores the viewport rather than resetting it.
    const poll = setInterval(() => {
      if (!document.hidden) setReloadKey((k) => k + 1);
    }, 20_000);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const bump = () => setTradeTick((t) => t + 1);
    window.addEventListener("fs-ledger", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("fs-ledger", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  // Live tick grows the current candle straight from feed ticks:
  // OHLC update, minute rollover, volume deltas, HA support.
  useEffect(() => {
    const ref = liveRef.current;
    if (!ref?.series || !tick?.ltp || !candles.length) return;
    const tickMs = Number(tick.ts) || 0;
    if (!tickMs) return;
    const bucket = tickBucket(tf, tickMs);
    if (!bucket) return; // weekly is too coarse to grow from a tick
    const step = intraStep(tf);
    let bar = ref.bar;
    if (!bar) {
      ref.bar = bar = { ...candles[candles.length - 1] };
    }
    if (bucket === bar.time) {
      bar.high = Math.max(bar.high, tick.ltp);
      bar.low = Math.min(bar.low, tick.ltp);
      bar.close = tick.ltp;
    } else if (bucket > bar.time) {
      // A bucket newer than the bar we hold. That is the rollover case: the
      // previous bucket's bar against the first tick of the new one. The old
      // code required the bucket to be *exactly* one step ahead, so an
      // overnight gap matched nothing, it returned, and the chart sat frozen
      // for the whole session.
      const fresh = Date.now() - tickMs < 5 * 60_000;
      if (!fresh) return; // stale tick — do not fabricate a bar from it

      // New candle: freeze the previous HA state, then start fresh.
      if (ref.kind === "ha") {
        const h = haOf(bar, ref.haPrev);
        ref.haPrev = { open: h.open, close: h.close };
      }

      if (step) {
        // Intraday: the new bucket starts at this tick's price.
        ref.bar = bar = {
          time: bucket,
          open: tick.ltp,
          high: tick.ltp,
          low: tick.ltp,
          close: tick.ltp,
          volume: 0,
        };
        // That open is only the first tick WE saw, which can land a beat after
        // the true first trade. Ask the server for this bucket shortly, once
        // it has written the bar, so the real OHLC replaces ours.
        if (reconcilingRef.current !== bucket) {
          reconcilingRef.current = bucket;
          if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
          reconcileTimer.current = setTimeout(() => {
            reconcileTimer.current = null;
            setReloadKey((k) => k + 1);
          }, 6000);
        }
      } else if (tf === "day") {
        // The tick carries the session's own OHLC, so a daily bar can be
        // seeded accurately rather than guessed from one price.
        const v0 = Number(tick.volume ?? 0);
        ref.bar = bar = {
          time: bucket,
          open: Number(tick.open ?? tick.ltp),
          high: Math.max(Number(tick.high ?? tick.ltp), tick.ltp),
          low: Math.min(Number(tick.low ?? tick.ltp), tick.ltp),
          close: tick.ltp,
          volume: v0,
        };
        ref.lastVol = v0 || null;
      } else {
        // Weekly: the fetch supplies the week's bar — Upstox ships the forming
        // week — so inventing one from a single tick would misstate the week's
        // open and range. Leave it to the fetch.
        return;
      }
    } else {
      return; // tick is older than the bar we hold — ignore it
    }
    // Weekly volume accumulates across days, so applying a same-day delta would
    // understate it. Keep the value the server merged instead.
    if (tf !== "week") {
      const v = Number(tick.volume ?? 0);
      if (v && ref.lastVol != null && v >= ref.lastVol)
        bar.volume += v - ref.lastVol;
      if (v) ref.lastVol = v;
    }
    try {
      if (ref.kind === "line" || ref.kind === "area") {
        ref.series.update({ time: bar.time as any, value: bar.close });
      } else if (ref.kind === "ha") {
        ref.series.update(haOf(bar, ref.haPrev));
      } else {
        ref.series.update({
          time: bar.time as any,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        });
      }
      ref.volSeries?.update({
        time: bar.time as any,
        value: bar.volume,
        color:
          bar.close >= bar.open ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)",
      });
      ref.lastTime = bar.time;
    } catch (e) {
      // A race with a chart rebuild is expected and harmless. Anything else
      // means the chart has quietly stopped tracking the feed — which used to
      // vanish into an empty catch, leaving no trace anywhere.
      if (process.env.NODE_ENV !== "production")
        console.warn("[chart] live candle update failed", sym, tf, e);
    }
  }, [tick, candles, tf]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !candles.length || !lwcReady) return;
    let chart: any = null;
    let rsiChart: any = null;
    let disposed = false;
    // Each chart gets its own child element. Disposing a chart rips its DOM out
    // of whatever container it was given, and lightweight-charts may still have
    // a paint queued in a rAF -- which then throws "Object is disposed" from its
    // device-pixel binding. With a private host the stale chart can be detached
    // immediately (so the next one gets a clean stage) and removed a frame
    // later, once that queued paint has landed.
    const host = document.createElement("div");
    el.appendChild(host);
    let rsiHost: HTMLDivElement | null = null;
    (async () => {
      const mod: any = lwcRef.current ?? (await import("lightweight-charts"));
      if (disposed || !wrapRef.current) return;
      const dark = resolvedTheme === "dark";
      const fg = dark ? "#e5e7eb" : "#111827";
      const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      const intra = tf === "1m" || tf === "5m" || tf === "15m";
      const narrow = el.clientWidth < 640;
      const mainH = inds.rsi ? (narrow ? 280 : 340) : narrow ? 320 : 420;
      const rsiH = narrow ? 90 : 110;
      chart = mod.createChart(host, {
        width: el.clientWidth,
        height: mainH,
        layout: {
          background: { color: "transparent" },
          textColor: fg,
          fontSize: 11,
        },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid },
        },
        rightPriceScale: { borderColor: grid },
        timeScale: { borderColor: grid, timeVisible: intra },
        crosshair: {
          vertLine: { labelBackgroundColor: dark ? "#374151" : "#6b7280" },
          horzLine: { labelBackgroundColor: dark ? "#374151" : "#6b7280" },
        },
      });
      const closes = candles.map((c) => c.close);
      const ha = ctype === "ha" ? heikin(candles) : null;
      let main: any;
      if (ctype === "line") {
        main = chart.addSeries(mod.LineSeries, {
          color: dark ? "#60a5fa" : "#2563eb",
          lineWidth: 2,
        });
        main.setData(
          candles.map((c) => ({ time: c.time as any, value: c.close })),
        );
      } else if (ctype === "area") {
        main = chart.addSeries(mod.AreaSeries, {
          lineColor: dark ? "#60a5fa" : "#2563eb",
          topColor: dark ? "rgba(96,165,250,0.4)" : "rgba(37,99,235,0.4)",
          bottomColor: "rgba(96,165,250,0)",
        });
        main.setData(
          candles.map((c) => ({ time: c.time as any, value: c.close })),
        );
      } else {
        main = chart.addSeries(mod.CandlestickSeries, {
          upColor: "#16a34a",
          downColor: "#dc2626",
          wickUpColor: "#16a34a",
          wickDownColor: "#dc2626",
          borderVisible: false,
        });
        main.setData(
          (ha ?? candles).map((c) => ({
            time: c.time as any,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
      }
      liveRef.current = {
        series: main,
        volSeries: null,
        lastTime: candles[candles.length - 1].time,
        kind: ctype,
        bar: { ...candles[candles.length - 1] },
        haPrev:
          ctype === "ha" && ha && ha.length > 1
            ? { open: ha[ha.length - 2].open, close: ha[ha.length - 2].close }
            : null,
        lastVol: null,
      };
      const volSeries = chart.addSeries(mod.HistogramSeries, {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
      });
      if (liveRef.current) liveRef.current.volSeries = volSeries;
      chart
        .priceScale("vol")
        .applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      volSeries.setData(
        candles.map((c) => ({
          time: c.time as any,
          value: c.volume,
          color:
            c.close >= c.open ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)",
        })),
      );
      const line = (vals: (number | null)[], color: string, width = 1) => {
        const s = chart.addSeries(mod.LineSeries, {
          color,
          lineWidth: width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(
          candles
            .map((c, i) =>
              vals[i] != null ? { time: c.time as any, value: vals[i]! } : null,
            )
            .filter(Boolean),
        );
      };
      if (inds.sma) {
        line(sma(closes, 20), "#f59e0b");
        line(sma(closes, 50), "#8b5cf6");
      }
      if (inds.ema) line(ema(closes, 20), "#06b6d4");
      if (inds.vwap) line(vwap(candles), "#ec4899", 2);
      if (compare && nifty.length > 1) {
        const base = nifty[0].close;
        const cmp = chart.addSeries(mod.LineSeries, {
          color: "#71717a",
          lineWidth: 1,
          priceScaleId: "cmp",
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        chart
          .priceScale("cmp")
          .applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
        cmp.setData(
          nifty.map((c) => ({
            time: c.time as any,
            value: ((c.close - base) / base) * 100,
          })),
        );
      }
      // Real fills: markers with live P&L + entry price line.
      try {
        const trades = getTrades()
          .filter((t) => String(t.scrip || "").toUpperCase() === sym)
          .slice(-30);
        if (trades.length && mod.createSeriesMarkers) {
          const times = candles.map((c) => c.time);
          const refPx = ltp > 0 ? ltp : candles[candles.length - 1].close;
          const markers = trades
            .map((t) => {
              const day =
                Math.floor((t.at ?? Date.now()) / 1000 / 86400) * 86400;
              const at = times.reduce(
                (best, ts) =>
                  Math.abs(ts - day) < Math.abs(best - day) ? ts : best,
                times[0],
              );
              const buy = t.side === "BUY";
              const pnl = (refPx - t.price) * t.qty * (buy ? 1 : -1);
              const sign = pnl >= 0 ? "+" : "−";
              return {
                time: at as any,
                position: buy ? "belowBar" : "aboveBar",
                color: buy ? "#16a34a" : "#dc2626",
                shape: buy ? "arrowUp" : "arrowDown",
                text: `${t.side} ${t.qty}@${t.price} (${sign}₹${Math.abs(Math.round(pnl))})`,
              };
            })
            .sort((a: any, b: any) => a.time - b.time);
          mod.createSeriesMarkers(main, markers);
          const latest = trades[trades.length - 1];
          if (latest && mod.LineStyle) {
            main.createPriceLine({
              price: latest.price,
              color: latest.side === "BUY" ? "#16a34a" : "#dc2626",
              lineWidth: 1,
              lineStyle: mod.LineStyle.Dashed,
              axisLabelVisible: true,
              title: `ENTRY ${latest.qty}@${latest.price}`,
            });
          }
        }
      } catch {
        // markers are best-effort
      }
      if (inds.rsi && rsiRef.current) {
        rsiRef.current.innerHTML = "";
        rsiHost = document.createElement("div");
        rsiRef.current.appendChild(rsiHost);
        rsiChart = mod.createChart(rsiHost, {
          width: rsiRef.current.clientWidth,
          height: rsiH,
          layout: {
            background: { color: "transparent" },
            textColor: fg,
            fontSize: 10,
          },
          grid: { vertLines: { color: grid }, horzLines: { color: grid } },
          rightPriceScale: { borderColor: grid },
          timeScale: { borderColor: grid, timeVisible: intra },
        });
        const r = rsi(closes);
        const rs = rsiChart.addSeries(mod.LineSeries, {
          color: "#8b5cf6",
          lineWidth: 1,
        });
        rs.setData(
          candles
            .map((c, i) =>
              r[i] != null ? { time: c.time as any, value: r[i]! } : null,
            )
            .filter(Boolean),
        );
        for (const lv of [70, 30]) {
          const l = rsiChart.addSeries(mod.LineSeries, {
            color: lv === 70 ? "#dc2626" : "#16a34a",
            lineWidth: 1,
            lineStyle: mod.LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          l.setData(candles.map((c) => ({ time: c.time as any, value: lv })));
        }
      } else if (rsiRef.current) {
        rsiRef.current.innerHTML = "";
      }
      const byTime = new Map(candles.map((c) => [c.time, c]));
      chart.subscribeCrosshairMove((p: any) => {
        if (!p?.time) {
          setHover(null);
          return;
        }
        setHover(byTime.get(Number(p.time)) ?? null);
      });
      // Restore where the user was looking. Data refresh rebuilds the chart,
      // so without this every periodic refresh would reset their zoom. Only for
      // the same symbol+timeframe — a new scrip opens at realtime.
      const viewKey = `${sym}|${tf}`;
      const saved = viewKeyRef.current === viewKey ? viewRef.current : null;
      viewKeyRef.current = viewKey;
      if (saved && !saved.atRealtime) {
        try {
          chart.timeScale().setVisibleLogicalRange({
            from: saved.from,
            to: saved.to,
          });
        } catch {
          chart.timeScale().scrollToRealTime();
        }
      } else {
        chart.timeScale().scrollToRealTime();
      }
      const onResize = () => {
        chart?.applyOptions({ width: el.clientWidth });
        rsiChart?.applyOptions({ width: rsiRef.current?.clientWidth ?? 0 });
      };
      window.addEventListener("resize", onResize);
      (chart as any).__off = () =>
        window.removeEventListener("resize", onResize);
    })();
    return () => {
      disposed = true;
      try {
        (chart as any)?.__off?.();
        // Remember the viewport before the chart goes away.
        try {
          const r = chart?.timeScale?.().getVisibleLogicalRange?.();
          if (r)
            viewRef.current = {
              from: r.from,
              to: r.to,
              atRealtime: r.to >= candles.length - 3,
            };
        } catch {
          /* chart already gone */
        }
      } catch {
        // ignore teardown race
      }
      // Deliberately NOT calling remove() here — see below.
      // Detach the canvases now so the next chart starts on a clean stage, then
      // dispose a frame later: a paint may already be queued, and disposing in
      // the same tick makes that queued paint call into a disposed device-pixel
      // binding ("Object is disposed"). rAF is paused in a hidden tab, so a
      // timer backstops it.
      try {
        host.remove();
      } catch {
        /* already gone */
      }
      try {
        rsiHost?.remove();
      } catch {
        /* already gone */
      }
      let killed = false;
      const kill = () => {
        if (killed) return;
        killed = true;
        try {
          chart?.remove?.();
        } catch {
          /* ignore */
        }
        try {
          rsiChart?.remove?.();
        } catch {
          /* ignore */
        }
      };
      requestAnimationFrame(kill);
      setTimeout(kill, 250);
      if (wrapRef.current) wrapRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    candles,
    nifty,
    resolvedTheme,
    ctype,
    inds,
    compare,
    tradeTick,
    lwcReady,
  ]);

  if (loading)
    return (
      <div className="flex h-[420px] items-center justify-center text-[13px] text-muted-foreground">
        LOADING {sym}…
      </div>
    );
  if (err || !candles.length)
    return (
      <div className="flex h-[220px] items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
        {err || `No chart data for ${sym}`}
        {ltp ? ` · LIVE ₹${Number(ltp).toFixed(2)}` : ""}
      </div>
    );

  const shown = hover ?? candles[candles.length - 1];
  const pct =
    shown && candles.length > 1
      ? ((shown.close - candles[0].close) / candles[0].close) * 100
      : 0;

  const tfBtn = (on: boolean) =>
    `min-h-[38px] sm:min-h-0 sm:px-3 sm:py-1.5 flex-1 rounded-lg text-xs sm:text-[11px] font-semibold whitespace-nowrap active:scale-95 transition ${on ? "bg-foreground text-background shadow" : "text-muted-foreground"}`;

  const chip = (on: boolean) =>
    `min-h-[34px] sm:min-h-0 sm:py-1 px-3 sm:px-2 rounded-full border text-xs sm:text-[11px] whitespace-nowrap shrink-0 active:scale-95 transition ${on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`;

  const strip =
    "flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible";

  return (
    <div>
      <div className="px-3 pt-2 pb-2 flex flex-col gap-2 text-[11px] font-mono">
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/40 p-1">
          {TFS.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={tfBtn(tf === t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className={strip}>
          {TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setCtype(t.id)}
              className={chip(ctype === t.id)}
            >
              {t.label}
            </button>
          ))}
          <span className="w-px self-stretch bg-border shrink-0 mx-0.5" />
          <button
            onClick={() => setInds((s: any) => ({ ...s, sma: !s.sma }))}
            className={chip(inds.sma)}
            title="SMA 20/50"
          >
            SMA
          </button>
          <button
            onClick={() => setInds((s: any) => ({ ...s, ema: !s.ema }))}
            className={chip(inds.ema)}
            title="EMA 20"
          >
            EMA
          </button>
          <button
            onClick={() => setInds((s: any) => ({ ...s, vwap: !s.vwap }))}
            className={chip(inds.vwap)}
            title="VWAP"
          >
            VWAP
          </button>
          <button
            onClick={() => setInds((s: any) => ({ ...s, rsi: !s.rsi }))}
            className={chip(inds.rsi)}
            title="RSI 14"
          >
            RSI
          </button>
          <button
            onClick={() => setCompare((v) => !v)}
            className={chip(compare)}
            title="Overlay NIFTY %"
          >
            NIFTY
          </button>
        </div>
      </div>

      <div className="px-3 sm:px-4 pb-2 text-xs font-mono">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-base sm:text-sm font-semibold text-foreground tabular-nums">
              {shown ? `₹${shown.close.toFixed(2)}` : "—"}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${pct >= 0 ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative"}`}
            >
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          </span>
          {ltp ? (
            <span className="flex items-center gap-1.5 text-foreground/60 shrink-0">
              <span className="live-dot" />₹{Number(ltp).toFixed(2)}
            </span>
          ) : null}
        </div>
        {shown ? (
          <div className="mt-1 grid grid-cols-4 gap-1 sm:flex sm:gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span>
              O{" "}
              <span className="text-foreground/80">
                {shown.open.toFixed(2)}
              </span>
            </span>
            <span>
              H{" "}
              <span className="text-foreground/80">
                {shown.high.toFixed(2)}
              </span>
            </span>
            <span>
              L{" "}
              <span className="text-foreground/80">{shown.low.toFixed(2)}</span>
            </span>
            <span>
              C{" "}
              <span className="text-foreground/80">
                {shown.close.toFixed(2)}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {loading ? (
        <div className="flex h-[420px] items-center justify-center text-[13px] text-muted-foreground">
          LOADING {sym} · {tf.toUpperCase()}…
        </div>
      ) : err || !candles.length ? (
        <div className="flex h-[220px] items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
          {err || `No chart data for ${sym}`}
          {ltp ? ` · LIVE ₹${Number(ltp).toFixed(2)}` : ""}
        </div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className={`w-full touch-pan-y ${inds.rsi ? "h-[280px] sm:h-[340px]" : "h-[320px] sm:h-[420px]"}`}
          />
          {inds.rsi ? (
            <div
              ref={rsiRef}
              className="w-full h-[90px] sm:h-[110px] touch-pan-y"
            />
          ) : null}
          <div className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
            {inds.sma ? (
              <>
                <span>
                  <i className="inline-block w-3 h-[2px] bg-[#f59e0b] mr-1 align-middle" />
                  SMA20
                </span>
                <span>
                  <i className="inline-block w-3 h-[2px] bg-[#8b5cf6] mr-1 align-middle" />
                  SMA50
                </span>
              </>
            ) : null}
            {inds.ema ? (
              <span>
                <i className="inline-block w-3 h-[2px] bg-[#06b6d4] mr-1 align-middle" />
                EMA20
              </span>
            ) : null}
            {inds.vwap ? (
              <span>
                <i className="inline-block w-3 h-[2px] bg-[#ec4899] mr-1 align-middle" />
                VWAP
              </span>
            ) : null}
            {compare ? (
              <span>
                <i className="inline-block w-3 h-[2px] bg-[#71717a] mr-1 align-middle" />
                NIFTY %
              </span>
            ) : null}
            <span className="text-positive">▲ BUY</span>
            <span className="text-negative">▼ SELL</span>
          </div>
        </>
      )}
    </div>
  );
}
