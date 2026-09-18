import { db } from "./db";

// ── Deposits ────────────────────────────────────────────────────────────────
//
// The amount a user has actually funded. Two writers, both server-side:
//
//   * the user, through POST /api/trade/deposit (self-service)
//   * an operator, through POST /api/admin/clients (a manual credit)
//
// Nothing else may write here, and no client ever supplies a running total.
// This matters because the total gates KYC: if the browser could report its own
// figure, anybody could unlock KYC by editing localStorage.
//
// A deposit does two things at once:
//   1. counts toward the admin's KYC deposit requirement, and
//   2. raises trading capital — see `tradingCapital()` in tradingServer.ts.
//
// The seeded `trade_accounts.start_cash` is deliberately NOT counted as a
// deposit. Every account is seeded with virtual capital the moment it is first
// used, so counting it would make everyone instantly eligible and the gate
// meaningless.

export type DepositMethod = "self" | "admin" | "gateway";

export type DepositRow = {
  id: number;
  user_id: string;
  ts: number;
  amount: number;
  method: string;
  actor: string | null;
  note: string | null;
};

/** Largest single top-up, so a typo cannot fund an account with ₹50,00,000. */
export const MAX_SINGLE_DEPOSIT = 500_000;

/** Lifetime ceiling per user — an unbounded total would mint capital. */
export const MAX_TOTAL_DEPOSITED = 1_000_000;

export type DepositResult =
  | { ok: true; total: number; duplicate: boolean }
  | { ok: false; error: string; status: number };

/** Newest-first deposit history for one account. */
export function depositsFor(key: string, limit = 200): DepositRow[] {
  return db
    .prepare(
      "SELECT * FROM trade_deposits WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
    )
    .all(key, limit) as DepositRow[];
}

/** Total deposited by one account. */
export function depositedTotal(key: string): number {
  const r = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS t FROM trade_deposits WHERE user_id = ?",
    )
    .get(key) as { t: number } | undefined;
  return Number(r?.t) || 0;
}

/**
 * Every account's total in one query — the analytics payload needs all of them
 * and must not do a per-user round trip.
 */
export function depositedTotals(): Map<string, number> {
  const rows = db
    .prepare(
      "SELECT user_id, COALESCE(SUM(amount), 0) AS t FROM trade_deposits GROUP BY user_id",
    )
    .all() as { user_id: string; t: number }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(String(r.user_id), Number(r.t) || 0);
  return out;
}

/**
 * Append a deposit. Returns the new total.
 *
 * `idem` makes retries safe: the same key from the same account is absorbed
 * instead of credited twice, so a double-submitted form cannot inflate a
 * balance or push someone over the KYC line by accident.
 */
export function recordDeposit(input: {
  key: string;
  amount: number;
  method: DepositMethod;
  actor?: string | null;
  note?: string | null;
  idem?: string | null;
  ts?: number;
}): DepositResult {
  const key = String(input.key || "");
  if (!key) return { ok: false, error: "No account", status: 400 };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Enter an amount above zero", status: 400 };
  if (amount > MAX_SINGLE_DEPOSIT)
    return {
      ok: false,
      error: `Single deposit is capped at ₹${MAX_SINGLE_DEPOSIT.toLocaleString("en-IN")}`,
      status: 400,
    };

  const idem = input.idem ? String(input.idem).slice(0, 64) : null;
  if (idem) {
    const seen = db
      .prepare(
        "SELECT id FROM trade_deposits WHERE user_id = ? AND idem = ? LIMIT 1",
      )
      .get(key, idem) as { id: number } | undefined;
    if (seen) return { ok: true, total: depositedTotal(key), duplicate: true };
  }

  const total = depositedTotal(key);
  if (total + amount > MAX_TOTAL_DEPOSITED)
    return {
      ok: false,
      error: `Lifetime deposit limit is ₹${MAX_TOTAL_DEPOSITED.toLocaleString("en-IN")}`,
      status: 400,
    };

  db.prepare(
    `INSERT INTO trade_deposits (user_id, ts, amount, method, actor, note, idem)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    key,
    input.ts || Date.now(),
    amount,
    input.method,
    input.actor ? String(input.actor).slice(0, 128) : null,
    input.note ? String(input.note).slice(0, 300) : null,
    idem,
  );

  return { ok: true, total: total + amount, duplicate: false };
}
