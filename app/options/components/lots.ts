"use client";
// NSE lot sizes per underlying (approximation).
// Indices have fixed lots; stock options default to 100 when unknown.

const LOTS: Record<string, number> = {
  NIFTY: 75,
  BANKNIFTY: 30,
  FINNIFTY: 65,
  SENSEX: 20,
  BANKEX: 30,
  NIFTYNXT50: 25,
};

export function lotSizeFor(underlying: string): number {
  const t = String(underlying || "").toUpperCase();
  if (LOTS[t]) return LOTS[t];
  // Single-stock options: lot varies by scrip; 100 is a sane paper default.
  return 100;
}
