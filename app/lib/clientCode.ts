// Human-facing "client code" — the ID a customer reads off their profile.
//
// Deliberately NOT `users.id`. The primary key doubles as the ledger key
// (`u-<id>`, see authStore.ledgerKeyFor), so every fill, position and deposit is
// filed under it; restyling the key would mean migrating live balances. This is
// a display value that happens to look like a broker account number:
//
//   TK267X9Q4
//   ^^ ^^ ^^^^^
//   |  |  └─ 5 random symbols, ~33.5M per year
//   |  └──── account-opening year (2 digits)
//   └─────── TradeKaro
//
// Pure module on purpose: db.ts imports it to backfill existing accounts, and
// anything db.ts imports must not import db.ts back.

/**
 * 32 symbols. `0`/`O` and `1`/`I` are omitted because they are misread when a
 * customer types a code off a screenshot or reads it out over the phone.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const PREFIX = "TK";
const RANDOM_LEN = 5;

/** `TK267X9Q4` — kept here so callers never hand-roll the shape. */
export const CLIENT_CODE_RE = /^TK\d{2}[23456789A-HJ-NP-Z]{5}$/;

export function isClientCode(v: unknown): boolean {
  return typeof v === "string" && CLIENT_CODE_RE.test(v);
}

/**
 * Uniform index in [0, n).
 *
 * n is always 32 here and 256 is an exact multiple of 32, so the modulo is
 * unbiased. Anything else would need rejection sampling.
 */
function randIndex(n: number): number {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return b[0] % n;
}

/**
 * Allocate a code that is not in `taken`.
 *
 * The caller owns `taken` (and must add the result to it) because only the
 * caller can see the whole table. A collision is retried rather than shipped —
 * and after 64 attempts in a 33-million space something is wrong, so throwing
 * beats handing out a duplicate.
 */
export function generateClientCode(year: number, taken: Set<string>): string {
  const yy = String(Math.abs(Math.trunc(year)) % 100).padStart(2, "0");
  for (let attempt = 0; attempt < 64; attempt++) {
    let tail = "";
    for (let i = 0; i < RANDOM_LEN; i++)
      tail += CODE_ALPHABET[randIndex(CODE_ALPHABET.length)];
    const code = `${PREFIX}${yy}${tail}`;
    if (!taken.has(code)) return code;
  }
  throw new Error("could not allocate a unique client code");
}

/** Every code already in use. Small enough to hold in memory; avoids a
 *  per-attempt query inside the retry loop. */
export function codesInUse(rows: { client_code?: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const v = String(r?.client_code ?? "").trim();
    if (v) out.add(v);
  }
  return out;
}
