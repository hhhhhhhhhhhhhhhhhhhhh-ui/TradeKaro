// Identity of a position leg, shared by the server ledger, the browser mirror
// and the Positions panel — they must agree on what "one row" means.
//
// CNC (delivery) and MIS (intraday) are separate legs with separate lives: one
// carries overnight, the other is force-closed at the square-off cutoff. They
// used to be grouped by scrip alone, with the product written once when the row
// was created and never updated, so mixing them produced a single row labelled
// after whichever leg opened FIRST. Parked on the wrong tab, charged the wrong
// margin, and — worst — the intraday square-off sold the delivery shares too.
//
// Every fill already records its own product, so only the grouping was wrong.
//
// A missing product reads as CNC, which is how the Positions panel has always
// displayed legacy rows.
export type Product = "CNC" | "MIS";

export function normalizeProduct(product?: string | null): Product {
  return product === "MIS" ? "MIS" : "CNC";
}

/**
 * Position-leg identity. The NUL separator cannot occur in a scrip, so a key can
 * never be formed two ways — `legKey("A", "B")` is not a valid scrip/produce pair
 * for any real instrument.
 */
export function legKey(scrip: string, product?: string | null): string {
  return `${scrip}\u0000${normalizeProduct(product)}`;
}

/** The scrip back out of a leg key. */
export function scripOf(leg: string): string {
  return leg.split("\u0000")[0];
}
