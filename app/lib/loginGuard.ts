import { db } from "./db";

// Brute-force protection for user login. Counters live in SQLite so a
// server restart doesn't reset an attacker's progress:
//   - key "ip|username": 5 fails → 15 min lock for that pair
//   - key "ip:<ip>":    25 fails → 15 min lock for the whole address

const MAX_PER_KEY = 5;
const MAX_PER_IP = 25;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const key = (ip: string, username: string) =>
  `${ip}|${username.trim().toLowerCase()}`.slice(0, 200);
const ipKey = (ip: string) => `ip:${ip}`.slice(0, 200);

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim();
  const raw = first || req.headers.get("x-real-ip")?.trim() || "local";
  return raw.slice(0, 64);
}

type Row = { n: number; first_at: number; locked_until: number };

function getRow(k: string): Row | null {
  const r = db
    .prepare("SELECT n, first_at, locked_until FROM auth_fails WHERE k = ?")
    .get(k) as any;
  return r
    ? {
        n: Number(r.n),
        first_at: Number(r.first_at),
        locked_until: Number(r.locked_until),
      }
    : null;
}

// Call before verifying credentials.
export function loginLockStatus(
  ip: string,
  username: string,
): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  for (const k of [key(ip, username), ipKey(ip)]) {
    const row = getRow(k);
    if (row && row.locked_until > now)
      return {
        locked: true,
        retryAfterSec: Math.ceil((row.locked_until - now) / 1000),
      };
  }
  return { locked: false, retryAfterSec: 0 };
}

function bump(k: string, max: number, now: number) {
  const row = getRow(k);
  if (!row || now - row.first_at > WINDOW_MS) {
    db.prepare(
      "INSERT INTO auth_fails (k, n, first_at, locked_until) VALUES (?,?,?,0) ON CONFLICT(k) DO UPDATE SET n = 1, first_at = ?, locked_until = 0",
    ).run(k, 1, now, now);
    return;
  }
  const n = row.n + 1;
  const locked = n >= max ? now + LOCK_MS : row.locked_until;
  db.prepare("UPDATE auth_fails SET n = ?, locked_until = ? WHERE k = ?").run(
    n,
    locked,
    k,
  );
}

export function recordLoginFail(ip: string, username: string) {
  const now = Date.now();
  bump(key(ip, username), MAX_PER_KEY, now);
  bump(ipKey(ip), MAX_PER_IP, now);
}

export function recordLoginSuccess(ip: string, username: string) {
  db.prepare("DELETE FROM auth_fails WHERE k = ?").run(key(ip, username));
}
