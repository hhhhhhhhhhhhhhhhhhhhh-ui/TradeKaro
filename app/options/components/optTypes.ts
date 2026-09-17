export type ChainRow = {
  strike: number;
  ceLtp: number;
  peLtp: number;
  ceOI: number;
  peOI: number;
  ceVol?: number;
  peVol?: number;
  ceIV?: number;
  peIV?: number;
};

export type Leg = {
  id: string;
  strike: number;
  side: "CE" | "PE";
  action: "BUY" | "SELL";
  price: number;
  lots: number;
};

export type ChainStats = {
  pcr: number;
  maxPain: number;
  totCeOi: number;
  totPeOi: number;
  support: number;
  resistance: number;
  atm: number;
};

// Put-call ratio, max-pain strike, and OI-based support/resistance.
export function calcStats(rows: ChainRow[], ltp: number): ChainStats | null {
  if (!rows.length) return null;
  const totCeOi = rows.reduce((a, r) => a + (r.ceOI || 0), 0);
  const totPeOi = rows.reduce((a, r) => a + (r.peOI || 0), 0);
  let maxPain = rows[0].strike;
  let minPain = Infinity;
  for (const k of rows) {
    let pain = 0;
    for (const r of rows) {
      pain += (r.ceOI || 0) * Math.max(0, k.strike - r.strike);
      pain += (r.peOI || 0) * Math.max(0, r.strike - k.strike);
    }
    if (pain < minPain) {
      minPain = pain;
      maxPain = k.strike;
    }
  }
  const support = rows.reduce((a, b) =>
    (b.peOI || 0) > (a.peOI || 0) ? b : a,
  ).strike;
  const resistance = rows.reduce((a, b) =>
    (b.ceOI || 0) > (a.ceOI || 0) ? b : a,
  ).strike;
  const atm = rows.reduce((a, b) =>
    Math.abs(b.strike - ltp) < Math.abs(a.strike - ltp) ? b : a,
  ).strike;
  return {
    pcr: totCeOi > 0 ? totPeOi / totCeOi : 0,
    maxPain,
    totCeOi,
    totPeOi,
    support,
    resistance,
    atm,
  };
}

export function fmtOI(n: number) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
