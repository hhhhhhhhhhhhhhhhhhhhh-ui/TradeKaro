// Candle-shape helpers.
//
// `/api/market/candles` returns full OHLC objects (`{time, open, high, low,
// close, volume}`) so lightweight-charts can draw real candles. Some older
// consumers still expect the legacy `[timestamp, close]` tuple shape — they
// were reading `c[1]` off an object, which yields `undefined` and produced
// `NaN` charts. Route everything through these helpers instead.

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

/** Normalise either shape into `[timestamp, close]` tuples, dropping junk. */
export function toCloseSeries(rows: unknown): [number, number][] {
  if (!Array.isArray(rows)) return [];
  const out: [number, number][] = [];
  for (const c of rows as any[]) {
    const pair: [number, number] = Array.isArray(c)
      ? [Number(c[0]), Number(c[1])]
      : [Number(c?.time), Number(c?.close)];
    if (Number.isFinite(pair[0]) && Number.isFinite(pair[1])) out.push(pair);
  }
  return out;
}

/** Normalise either shape into full OHLC candles. */
export function toCandleSeries(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const c of rows as any[]) {
    const candle: Candle = Array.isArray(c)
      ? {
          time: Number(c[0]),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5] ?? 0),
        }
      : {
          time: Number(c?.time),
          open: Number(c?.open),
          high: Number(c?.high),
          low: Number(c?.low),
          close: Number(c?.close),
          volume: Number(c?.volume ?? 0),
        };
    if (
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
    )
      out.push(candle);
  }
  return out;
}
