// Canonical number formatting for the whole app.
//
// Before this existed, screens mixed `toFixed(0)` / `toFixed(1)` /
// `toFixed(2)` / `toLocaleString("en-IN")`, so the same ₹ amount could render
// as `₹124765`, `₹124765.3` or `₹1,24,765` depending on the panel. Everything
// user-facing should go through these helpers.

const grouped0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const grouped2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * Collapse a rounding artefact to zero.
 *
 * Average-cost maths leaves dust behind — a long closed at its own entry price
 * computes to −1.1e-13, not 0. Formatting that as "−₹0.00" reads like a small
 * loss. Anything that rounds to 0.00 is treated as exactly 0.
 */
function tidy(value: number): number {
  const n = Number.isFinite(value) ? value : 0;
  return Math.abs(n) < 0.005 ? 0 : n;
}

/** Indian-grouped number: 1234567 → "12,34,567". */
export function num(value: number, decimals = 0): string {
  const n = Number.isFinite(value) ? value : 0;
  return (decimals ? grouped2 : plain).format(n);
}

/**
 * Money, sign before the symbol: 1234567 → "₹12,34,567", -500 → "−₹500".
 * Use `decimals: 2` for prices, default 0 for amounts/values.
 */
export function money(value: number, decimals = 0): string {
  const n = tidy(value);
  return `${n < 0 ? "−" : ""}₹${num(Math.abs(n), decimals)}`;
}

/** Money with an explicit sign: 500 → "+₹500", -500 → "−₹500". */
export function moneySigned(value: number, decimals = 0): string {
  const n = tidy(value);
  return `${n < 0 ? "−" : "+"}₹${num(Math.abs(n), decimals)}`;
}

/** Percentage with an explicit sign: 1.2345 → "+1.23%". */
export function pctSigned(value: number, decimals = 2): string {
  const n = tidy(value);
  return `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(decimals)}%`;
}

/**
 * P&L with an explicit sign, at a precision that scales with magnitude.
 *
 * `toFixed(0)` on a small position rounds a real move to a flat "+₹0" — one
 * share moving 40 paise looked identical to a position that had not moved at
 * all. Small amounts keep paise; large ones stay readable.
 */
export function pnlSigned(value: number): string {
  const n = tidy(value);
  const abs = Math.abs(n);
  return `${n < 0 ? "−" : "+"}₹${abs < 1000 ? abs.toFixed(2) : num(abs, 0)}`;
}

/** Percentage without a sign: 1.2345 → "1.23%". */
export function pct(value: number, decimals = 2): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${n.toFixed(decimals)}%`;
}

/** Compact price for dense rows: 2 decimals, grouped. */
export function price(value: number): string {
  return money(value, 2);
}
