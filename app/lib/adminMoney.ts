import { db } from "./db";
import { legKey } from "./positionKeys";
import { withdrawalSummary } from "./withdrawals";

// ── Platform-wide money ─────────────────────────────────────────────────────
//
// The four numbers an operator actually needs on the dashboard: what came in,
// what went out, what the platform is holding for customers, and how the book
// has gone. All of them are derived here rather than added up in the browser,
// and all of them are derived from the SAME ledgers the rest of the app writes
// — `trade_deposits`, `withdrawals` and `trade_fills`.
//
// ⚠️ The realised-P&L walk below must mirror `deriveAccount` in tradingServer.ts
// (average-cost positions, realised counted only on a leg that has gone flat as
// net cash). If those definitions drift, the dashboard starts disagreeing with
// every client's own portfolio page — and a dashboard that lies is worse than no
// dashboard.

export type PlatformMoney = {
  /** Real money in: verified gateway payments plus operator credits. */
  deposits: number;
  /** Practice credits — tradeable, deliberately not payable out. */
  practiceCredit: number;
  /** Actually paid out (the provider said success). */
  withdrawn: number;
  /** Approved or processing: leaving, not yet gone. */
  inFlight: number;
  /** Requested and waiting on a human. */
  pending: number;
  /** Withdrawn requests still waiting for approval, in rupees. */
  pendingCount: number;
  /**
   * What the platform is holding FOR customers: every wallet balance, summed.
   * This is the liability, and the number that should never exceed the money in
   * the gateway account.
   */
  liability: number;
  /** Accounts with money in them. */
  fundedAccounts: number;
  /** Accounts that have ever closed a round trip. */
  traders: number;
  /** Sum of every account's realised P&L. Negative means users are down. */
  usersPnl: number;
  /** The losing half only, as a positive number. */
  usersLosing: number;
  /** The winning half only. */
  usersWinning: number;
};

const n = (v: unknown) => Number(v) || 0;

/** Separator between the user id and the leg key — a NUL, which neither holds. */
const SEP = "\u0000";

export function platformMoney(): PlatformMoney {
  const sum = (sql: string, ...args: unknown[]): number => {
    const r = db.prepare(sql).get(...(args as any[])) as
      | { t: number }
      | undefined;
    return n(r?.t);
  };

  // Real money in. `self` rows are practice credits and are reported separately
  // — counting them as deposits is exactly the mistake that let a customer fund
  // themselves and then withdraw it.
  const deposits = sum(
    "SELECT COALESCE(SUM(amount),0) AS t FROM trade_deposits WHERE method IN ('admin','gateway')",
  );
  const practiceCredit = sum(
    "SELECT COALESCE(SUM(amount),0) AS t FROM trade_deposits WHERE method NOT IN ('admin','gateway')",
  );

  const w = withdrawalSummary();

  // The liability, per account: verified deposits minus everything held against
  // them, floored at zero each. Summing the floored figures per account is not
  // the same as (total in − total held) if any account were ever over-withdrawn,
  // and the difference is the whole reason to compute it this way.
  const liability = sum(`
    SELECT COALESCE(SUM(MAX(0, d.t - COALESCE(w.t, 0))), 0) AS t FROM (
      SELECT user_id, SUM(amount) AS t FROM trade_deposits
       WHERE method IN ('admin','gateway') GROUP BY user_id
    ) d
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS t FROM withdrawals
       WHERE status NOT IN ('rejected','failed') GROUP BY user_id
    ) w ON w.user_id = d.user_id
  `);
  const fundedAccounts = n(
    (
      db
        .prepare(
          `
          SELECT COUNT(*) AS c FROM (
            SELECT user_id FROM trade_deposits
             WHERE method IN ('admin','gateway') GROUP BY user_id
          )
        `,
        )
        .get() as { c: number } | undefined
    )?.c,
  );

  // ── realised P&L, one pass over the whole fill log ──
  const fills = db
    .prepare(
      "SELECT user_id, symbol, product, side, qty, price, value, ts FROM trade_fills ORDER BY ts ASC, id ASC",
    )
    .all() as any[];

  // ⚠️ Realised P&L is banked AT THE MOMENT a leg goes flat, not read off the
  // legs that happen to be flat when the walk ends. The difference is a leg that
  // completed a round trip and was then reopened: the round trip is realised and
  // belongs in the total, while the reopened half is unrealised and does not.
  // Collecting only the final flat legs silently deletes the first round trip —
  // this walk reported ₹34 where the customer-facing ledger says ₹270, and every
  // one of those reopens was a real trade. `deriveAccount` banks incrementally;
  // so does this now.
  const realised = new Map<string, number>();
  const legs = new Map<string, { qty: number; avg: number; open: number }>();

  for (const f of fills) {
    const k = `${f.user_id}${SEP}${legKey(f.symbol, f.product)}`;
    const L = legs.get(k) || { qty: 0, avg: 0, open: 0 };
    const qty = Math.abs(Number(f.qty));
    const price = Number(f.price);
    const val = Number(f.value) || qty * price;
    const delta = f.side === "BUY" ? qty : -qty;

    // Average cost, copied from deriveAccount — including the rule that only
    // ADDED units move the average, so a partial exit cannot inflate it.
    if (L.qty === 0) {
      L.qty = delta;
      L.avg = price;
    } else if (Math.sign(delta) === Math.sign(L.qty)) {
      const absOld = Math.abs(L.qty);
      const absNew = Math.abs(L.qty + delta);
      if (absNew > absOld) L.avg = (absOld * L.avg + qty * price) / absNew;
      L.qty += delta;
    } else {
      const flipped = Math.sign(L.qty + delta) !== Math.sign(L.qty);
      L.qty += delta;
      if (flipped && L.qty !== 0) L.avg = price;
    }

    // Net cash for the leg, banked the moment it goes flat — and kept even if
    // the leg is opened again afterwards.
    const open = L.open + (f.side === "SELL" ? val : -val);
    if (L.qty === 0) {
      realised.set(
        k.slice(0, k.indexOf(SEP)),
        (realised.get(k.slice(0, k.indexOf(SEP))) || 0) + open,
      );
      L.open = 0;
    } else {
      L.open = open;
    }
    legs.set(k, L);
  }

  let usersPnl = 0;
  let usersLosing = 0;
  let usersWinning = 0;
  for (const pnl of realised.values()) {
    usersPnl += pnl;
    if (pnl < 0) usersLosing += pnl;
    else usersWinning += pnl;
  }

  return {
    deposits,
    practiceCredit,
    withdrawn: w.paidTotal,
    inFlight: Math.max(0, w.heldTotal - w.pendingTotal - w.paidTotal),
    pending: w.pendingTotal,
    pendingCount: w.pendingCount,
    liability,
    fundedAccounts,
    traders: realised.size,
    usersPnl,
    usersLosing,
    usersWinning,
  };
}
