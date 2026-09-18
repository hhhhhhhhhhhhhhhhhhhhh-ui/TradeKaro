import { db } from "./db";

// ── Withdrawals ─────────────────────────────────────────────────────────────
//
// The single record of money leaving. `deriveAccount` subtracts the sum of every
// withdrawal that has not been rejected or failed, which is what keeps the
// customer's balance honest: the moment a request is made the money stops being
// available, so it cannot be requested twice while an operator is deciding, and
// it stops showing as spendable trading capital.
//
// ── Lifecycle ──
//
//   requested ──► approved ──► processing ──► success
//        │            │
//        └────────────┴──────► rejected / failed   (released, money comes back)
//
// `id` doubles as the gateway payout id. That is the whole idempotency story:
// approving twice is impossible because the second attempt finds a status that
// is no longer `requested`, and even if two requests raced, the provider would
// reject the second on the duplicate payout id.
//
// Nothing here calls the payment gateway. Sending money lives in `payments.ts`
// and the routes, so this module stays importable by `tradingServer.ts` without
// a cycle — which matters, because the account maths depends on it.

export type WithdrawalStatus =
  | "requested"
  | "approved"
  | "processing"
  | "success"
  | "rejected"
  | "failed";

export type Withdrawal = {
  id: string;
  user_id: string;
  amount: number;
  fee: number;
  net_amount: number;
  account_id: string | null;
  status: WithdrawalStatus;
  reason: string | null;
  payout_id: string | null;
  utr: string | null;
  requested_at: number;
  decided_at: number | null;
  decided_by: string | null;
  updated_at: number;
};

/**
 * Statuses where the money is spoken for.
 *
 * `rejected` and `failed` are the only two that release it — a failed payout
 * means nothing left the building, so returning it to the customer is the only
 * honest option. Everything else, including a request nobody has looked at yet,
 * holds the funds.
 */
const RELEASED: WithdrawalStatus[] = ["rejected", "failed"];

/** Sum held against this account. Subtracted by `deriveAccount`. */
export function withdrawnTotal(userId: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM withdrawals
        WHERE user_id = ? AND status NOT IN ('rejected','failed')`,
    )
    .get(userId) as { t: number } | undefined;
  return Number(r?.t) || 0;
}

/** Pending only — what an operator still has to act on. */
export function pendingTotal(userId: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM withdrawals
        WHERE user_id = ? AND status = 'requested'`,
    )
    .get(userId) as { t: number } | undefined;
  return Number(r?.t) || 0;
}

export function withdrawalRowsFor(userId: string, limit = 50): Withdrawal[] {
  return db
    .prepare(
      `SELECT * FROM withdrawals WHERE user_id = ?
        ORDER BY requested_at DESC LIMIT ?`,
    )
    .all(userId, limit) as Withdrawal[];
}

export function allWithdrawals(limit = 200): Withdrawal[] {
  return db
    .prepare("SELECT * FROM withdrawals ORDER BY requested_at DESC LIMIT ?")
    .all(limit) as Withdrawal[];
}

/** Oldest first: an operator should work a queue, not a stack. */
export function pendingWithdrawals(limit = 100): Withdrawal[] {
  return db
    .prepare(
      `SELECT * FROM withdrawals WHERE status = 'requested'
        ORDER BY requested_at ASC LIMIT ?`,
    )
    .all(limit) as Withdrawal[];
}

export function withdrawalById(id: string): Withdrawal | undefined {
  return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id) as
    | Withdrawal
    | undefined;
}

function newId(): string {
  return `WD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function money2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

export type WithdrawalLimits = {
  min: number;
  max: number;
  /** Free cash the account actually has, from `deriveAccount`. */
  withdrawable: number;
};

function checkLimits(amount: number, limits: WithdrawalLimits) {
  if (!Number.isFinite(amount) || amount <= 0)
    return {
      ok: false as const,
      error: "Enter an amount above zero",
      status: 400,
    };
  if (limits.min > 0 && amount < limits.min)
    return {
      ok: false as const,
      error: `Minimum withdrawal is ₹${limits.min.toLocaleString("en-IN")}`,
      status: 400,
    };
  if (limits.max > 0 && amount > limits.max)
    return {
      ok: false as const,
      error: `Maximum withdrawal is ₹${limits.max.toLocaleString("en-IN")}`,
      status: 400,
    };
  // The honest comparison: what the account can actually cover right now, with
  // every other request already deducted.
  if (amount > limits.withdrawable + 0.01)
    return {
      ok: false as const,
      error:
        `Only ₹${Math.max(0, limits.withdrawable).toLocaleString("en-IN")} is ` +
        `available to withdraw.`,
      status: 400,
    };
  return { ok: true as const };
}

export type RequestResult =
  | { ok: true; withdrawal: Withdrawal }
  | { ok: false; error: string; status: number };

/**
 * A customer asking for money.
 *
 * Everything is validated against the SERVER's numbers — the amount, the
 * account, and how much is actually free. The browser supplies an amount and an
 * account id, and nothing else.
 */
export function requestWithdrawal(input: {
  userId: string;
  amount: number;
  accountId: string;
  limits: WithdrawalLimits;
  /** When false the request is created already approved (operator-created). */
  needsApproval?: boolean;
  actor?: string | null;
}): RequestResult {
  const amount = money2(Number(input.amount));
  const bad = checkLimits(amount, input.limits);
  if (!bad.ok) return bad;

  const acct = db
    .prepare("SELECT id FROM payout_accounts WHERE id = ? AND user_id = ?")
    .get(input.accountId, input.userId) as { id: string } | undefined;
  if (!acct)
    return {
      ok: false,
      error: "Choose a saved account to withdraw to",
      status: 400,
    };

  const now = Date.now();
  const id = newId();
  // `needsApproval: false` is the operator path: it is created already approved
  // so an admin never has to approve their own action, but it still lands in the
  // same ledger with the same id, so the books balance either way.
  const status: WithdrawalStatus =
    input.needsApproval === false ? "approved" : "requested";

  db.prepare(
    `INSERT INTO withdrawals
       (id, user_id, amount, fee, net_amount, account_id, status, requested_at,
        decided_at, decided_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.userId,
    amount,
    0,
    amount,
    input.accountId,
    status,
    now,
    status === "approved" ? now : null,
    status === "approved" ? input.actor || null : null,
    now,
  );

  return { ok: true, withdrawal: withdrawalById(id)! };
}

function setStatus(
  id: string,
  status: WithdrawalStatus,
  extra: Record<string, unknown> = {},
): void {
  const keys = Object.keys(extra);
  db.prepare(
    `UPDATE withdrawals SET status = ?, updated_at = ?${
      keys.length ? ", " + keys.map((k) => `${k} = ?`).join(", ") : ""
    } WHERE id = ?`,
  ).run(status, Date.now(), ...(keys.map((k) => extra[k]) as any[]), id);
}

export function markApproved(id: string, actor: string): void {
  setStatus(id, "approved", { decided_at: Date.now(), decided_by: actor });
}

export function markProcessing(id: string): void {
  setStatus(id, "processing");
}

export function markRejected(id: string, actor: string, reason: string): void {
  setStatus(id, "rejected", {
    decided_at: Date.now(),
    decided_by: actor,
    reason: reason.slice(0, 300) || null,
  });
}

/**
 * A rejection that has to be undone — e.g. the customer asked again after
 * fixing their account. Puts the row back in the queue rather than editing
 * history.
 */
export function reopen(id: string): void {
  setStatus(id, "requested", {
    reason: null,
    decided_at: null,
    decided_by: null,
  });
}

/**
 * Follow the payout's own state.
 *
 * Called from the payout webhook so the customer's view of their withdrawal
 * tracks the provider's final word rather than our optimistic one. `failed`
 * releases the funds, which is correct: nothing was sent.
 */
export function syncFromPayout(
  payoutId: string,
  status: string,
  extra: { utr?: string | null; fee?: number | null; net?: number | null } = {},
): Withdrawal | undefined {
  const w = db
    .prepare("SELECT * FROM withdrawals WHERE id = ? OR payout_id = ?")
    .get(payoutId, payoutId) as Withdrawal | undefined;
  if (!w) return undefined;

  const next: WithdrawalStatus =
    status === "success"
      ? "success"
      : status === "failed"
        ? "failed"
        : status === "expired"
          ? "failed"
          : "processing";

  setStatus(w.id, next, {
    utr: extra.utr ?? w.utr,
    fee: Number.isFinite(Number(extra.fee)) ? Number(extra.fee) : w.fee,
    net_amount: Number.isFinite(Number(extra.net))
      ? Number(extra.net)
      : w.net_amount,
    payout_id: payoutId,
  });
  return withdrawalById(w.id);
}

export function attachPayout(id: string, payoutId: string): void {
  setStatus(id, "processing", { payout_id: payoutId });
}

/** Counters for the Finance page. */
export function withdrawalSummary() {
  const rows = db
    .prepare(
      "SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM withdrawals GROUP BY status",
    )
    .all() as { status: string; n: number; total: number }[];
  const get = (s: string) => rows.find((r) => r.status === s);
  return {
    byStatus: rows,
    pendingCount: Number(get("requested")?.n) || 0,
    pendingTotal: Number(get("requested")?.total) || 0,
    heldTotal: rows
      .filter((r) => !RELEASED.includes(r.status as WithdrawalStatus))
      .reduce((s, r) => s + Number(r.total), 0),
    paidCount: Number(get("success")?.n) || 0,
    paidTotal: Number(get("success")?.total) || 0,
  };
}

export { RELEASED };
