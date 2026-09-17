import { randomBytes } from "crypto";
import { kvGet, kvSet } from "./db";

// ── Connection tokens ──────────────────────────────────────────────────────
//
// The credential a user pastes into an external trader to link this account.
// It is minted server-side, once per account, and stored in `kv` — so revealing
// it twice shows the same value. A token that changed on every reveal would not
// behave like a credential, and a token the browser could invent would not be
// one either.
//
// Whether a token is handed out at all is decided in
// app/api/account/connect/route.ts, never here.

// Unambiguous alphabet: no I/O/0/1, which get misread as each other when a
// person copies a key by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** 15 characters, hyphen-grouped — the shape every platform's key has. */
export const TOKEN_LENGTH = 15;
export const TOKEN_GROUPS = 5;

function pick(set: string): string {
  // One independent byte per character; the modulo bias across a 24–32 symbol
  // alphabet is irrelevant for a displayed key.
  return set[randomBytes(1)[0] % set.length];
}

function randomChars(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * A token that always mixes letters and digits.
 *
 * A uniform draw from `ALPHABET` comes out all-letters roughly 1 time in 75, and
 * "a code with numbers and letters in it" is what a user was promised — so the
 * mix is enforced rather than left to chance. One position is reserved for each
 * kind, the rest stay uniform, and the result is shuffled so the reserved slots
 * are not predictable.
 */
function mixedChars(len: number): string {
  const chars = randomChars(len).split("");
  chars[0] = pick(LETTERS);
  chars[1] = pick(DIGITS);
  for (let i = len - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** `ABCDE-FGHJK-MNPQR` — always 15 alphanumerics plus the separators. */
export function formatToken(raw: string) {
  return raw.replace(new RegExp(`(.{${TOKEN_GROUPS}})(?=.)`, "g"), "$1-");
}

/** The account's token, minted on first request and then stable. */
export function connectTokenFor(userId: string): string {
  const key = `connect_token:${userId}`;
  const existing = kvGet(key);
  if (existing) return existing;
  const token = formatToken(mixedChars(TOKEN_LENGTH));
  kvSet(key, token);
  return token;
}

/**
 * Issue a fresh token, invalidating the old one. Not wired to any button yet —
 * kept next to the mint so a "rotate" action only has to call this.
 */
export function rotateConnectTokenFor(userId: string): string {
  const token = formatToken(mixedChars(TOKEN_LENGTH));
  kvSet(`connect_token:${userId}`, token);
  return token;
}
