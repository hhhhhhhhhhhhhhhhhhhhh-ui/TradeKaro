// Physical size and family grouping for MCX commodity roots. Client-safe: no
// node imports, so the browser can use it directly.
//
// Two separate problems live here, and only one of them is solvable by guessing.
//
// 1. FAMILY. MCX lists several contracts per commodity at wildly different
//    sizes, and they are separate roots — GOLD, GOLDM, GOLD10G, GOLD1G,
//    GOLDGUINEA, GOLDPETAL and GOLDTEN are seven rows describing one metal. A
//    flat table of 33 rows is really about a dozen commodities. The family is
//    derived by longest-prefix match, and **anything unmatched becomes its own
//    family** — so a root MCX adds tomorrow is never hidden, it just arrives
//    ungrouped. That fallback is the whole reason a list is acceptable here;
//    /topmovers learned this the hard way with a hardcoded universe.
//
// 2. PACK SIZE. What one lot physically IS. This one cannot be derived, so it is
//    not guessed. `lot_size` in the master is inconsistent by design — GOLD
//    reports 1 (a 1 kg contract), GOLDM 100 (100 g) and GOLDGUINEA 8 (8 g),
//    three different units in one column — so the entries below are the ones
//    verified against live rupees-per-gram in `instruments.ts`, plus the two the
//    same comment states outright (SILVER 30 kg per kg, CRUDEOIL 100 barrels per
//    barrel).
//
//    Everything absent from this table renders the lot as a bare number, which
//    is what the page did before and is never *wrong* — it just says less.
//    Roots were deliberately left out where the unit is unverified: ZINC and
//    LEAD and ALUMINIUM report lot_size 5, which is 5 **tonnes** on MCX but
//    reads as 5 units here, so labelling them "5 kg" would publish a number
//    off by a factor of a thousand. A missing label beats a wrong one.

/** What one quoted unit of a root physically is, e.g. 10 g of gold. */
export type QuotedUnit = { each: number; unit: string };

/** Per-unit physical size, for roots where it has been verified. See above. */
export const COMMODITY_PACK: Record<string, QuotedUnit> = {
  // Gold family, cross-checked against each other and against GOLDPETAL, which
  // is unambiguously one gram.
  GOLD: { each: 10, unit: "g" }, // 100 units -> 1 kg
  GOLDM: { each: 10, unit: "g" }, // 10 units -> 100 g
  GOLDGUINEA: { each: 8, unit: "g" }, // 1 unit -> 8 g
  GOLD10G: { each: 10, unit: "g" }, // 1 unit -> 10 g
  GOLD1G: { each: 1, unit: "g" }, // 1 unit -> 1 g
  GOLDPETAL: { each: 1, unit: "g" }, // 1 unit -> 1 g
  SILVER: { each: 1, unit: "kg" }, // 30 units -> 30 kg
  CRUDEOIL: { each: 1, unit: "barrel" }, // 100 units -> 100 barrels
};

/**
 * Known families, longest first where one name prefixes another.
 *
 * Deliberately does NOT list the size variants. `ZINCMINI`, `LEADMINI`,
 * `SILVERM`, `CRUDEOILM` and the rest all begin with their parent's name, so a
 * plain prefix match folds them in — listing them separately is what turned
 * every mini into a group of its own and defeated the point. Order still
 * matters in two places: `COTTONOIL` before `COTTON` (cottonseed oil and cotton
 * fibre are unrelated contracts that share six letters) and `BRCRUDEOIL` before
 * `CRUDEOIL`.
 *
 * Anything unmatched becomes its own family, so a root MCX adds tomorrow is
 * never hidden — it just arrives ungrouped. That fallback is the whole reason a
 * list is acceptable here; /topmovers learned this the hard way with a
 * hardcoded universe that silently drifted.
 */
export const COMMODITY_FAMILIES = [
  "COTTONOIL",
  "COTTON",
  "BRCRUDEOIL",
  "CRUDEOIL",
  "NATURALGAS",
  "GOLD",
  "SILVER",
  "ZINC",
  "ALUMINIUM",
  "LEAD",
  "NICKEL",
  "COPPER",
];

/**
 * Roots that name the same commodity as another root without prefixing it.
 *
 * `ALUMINI` is the aluminium mini but does not begin with `ALUMINIUM`, and the
 * natural-gas variants are `NATGAS*` while the parent is `NATURALGAS` — no
 * prefix rule can connect those, so they are stated. Without this they render
 * as one-row groups, which is not wrong, just useless.
 */
const FAMILY_ALIAS: Record<string, string> = {
  ALUMINI: "ALUMINIUM",
  NATGASMINI: "NATURALGAS",
  NATGASIND: "NATURALGAS",
  ELECMBL: "ELEC",
  ELECDMBL: "ELEC",
};

/** Display names. Anything unlisted falls back to the raw root. */
const FAMILY_LABEL: Record<string, string> = {
  GOLD: "Gold",
  SILVER: "Silver",
  CRUDEOIL: "Crude Oil",
  BRCRUDEOIL: "Brent Crude",
  NATURALGAS: "Natural Gas",
  COPPER: "Copper",
  ZINC: "Zinc",
  LEAD: "Lead",
  NICKEL: "Nickel",
  ALUMINIUM: "Aluminium",
  STEELREBAR: "Steel Rebar",
  COTTON: "Cotton",
  COTTONOIL: "Cottonseed Oil",
  MENTHAOIL: "Mentha Oil",
  CARDAMOM: "Cardamom",
  KAPAS: "Kapas",
  ELEC: "Electricity",
};

/**
 * The commodity a root belongs to. An unknown root is its own family, so
 * nothing is ever dropped from the page by failing to match.
 */
export function familyOf(root: string): string {
  const r = String(root || "").toUpperCase();
  if (!r) return "";
  return (
    FAMILY_ALIAS[r] ?? COMMODITY_FAMILIES.find((f) => r.startsWith(f)) ?? r
  );
}

export function familyLabel(family: string): string {
  const f = String(family || "").toUpperCase();
  return FAMILY_LABEL[f] ?? f;
}

/** "1 kg", "100 g", "100 barrels" — grams collapse to kg once they reach 1000. */
function weight(grams: number): string {
  return grams >= 1000 ? `${trim(grams / 1000)} kg` : `${trim(grams)} g`;
}

function trim(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** "100 barrels", but never "30 kgs" — mass units are not pluralised. */
function plural(unit: string, n: number): string {
  if (unit === "g" || unit === "kg") return unit;
  return n === 1 ? unit : `${unit}s`;
}

/**
 * What one lot is, in words — "100 × 10 g = 1 kg", "30 kg", "100 barrels".
 *
 * Returns null for roots whose unit is unverified, which is the honest answer:
 * the row then shows the lot as a plain number rather than a confident label
 * that may be wrong. `unitLine` states the single-unit size, which is what the
 * fractional-lot mode actually lets a customer buy.
 */
export function packLabel(root: string, lot: number): string | null {
  const spec = COMMODITY_PACK[String(root || "").toUpperCase()];
  if (!spec || !(lot > 0)) return null;
  if (spec.unit === "g") {
    const total = weight(spec.each * lot);
    return spec.each === 1 ? total : `${lot} × ${trim(spec.each)} g = ${total}`;
  }
  return spec.each === 1
    ? `${trim(spec.each * lot)} ${plural(spec.unit, spec.each * lot)}`
    : `${lot} × ${trim(spec.each)} ${plural(spec.unit, spec.each)} = ${trim(
        spec.each * lot,
      )} ${plural(spec.unit, spec.each * lot)}`;
}

/** "10 g", "1 kg", "1 barrel" — what one quoted unit buys, for the sub-line. */
export function unitLabel(root: string): string | null {
  const spec = COMMODITY_PACK[String(root || "").toUpperCase()];
  if (!spec) return null;
  if (spec.unit === "g") return weight(spec.each);
  return `${trim(spec.each)} ${plural(spec.unit, spec.each)}`;
}
