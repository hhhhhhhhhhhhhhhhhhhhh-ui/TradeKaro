import { db } from "./db";
import { ledgerKeyFor } from "./authStore";
import { runtimeSettings } from "./adminRuntime";
import { cached } from "./marketCache";
import { deriveAccount, ensureAccount, marginPctFor } from "./tradingServer";
import {
  hasUpstox,
  resolveUpstoxKey,
  setRuntimeToken,
  upstoxBatchQuotes,
} from "./upstox";

// Server-side view of a user's trading account.
//
// This used to read the legacy_books JSON snapshot. Nothing has written that
// table since fills moved behind POST /api/trade/order — it survives only as a
// one-time import source — so both values derived from it were wrong:
// `remainingCash` was the admin's *global* "Start cash" setting (every user saw
// ₹1,00,000 in the navbar forever, whatever they had deposited or traded), and
// anything position-based read an empty book. Everything here is now derived
// from the same authoritative ledger the rest of the app uses.

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type AccountSnapshot = {
  remainingCash: number;
  spentCash: number;
  scrips: { scrip: string; buyPrice: number; quantity: number }[];
};

/**
 * The account summary consumed by the navbar funds pill, the dashboard strip,
 * the portfolio wallet, the ledger and the profile page.
 */
export async function accountSnapshot(
  userId: string,
  email?: string | null,
): Promise<AccountSnapshot> {
  const key = ledgerKeyFor(userId);
  // Seed on first read. Without this a brand-new account derives start_cash = 0
  // until some other call happens to run ensureAccount(), so the navbar and
  // dashboard showed ₹0 for a fresh user who owned ₹1,00,000 of capital.
  await ensureAccount(key);
  const acct = deriveAccount(key, await marginPctFor(email));
  return {
    // Free margin is what the UI calls the wallet: capital + deposits, less
    // what the fills consumed, charges and committed margin.
    remainingCash: r2(acct.cash),
    spentCash: r2(Math.max(0, acct.netSpent)),
    scrips: acct.positions
      .filter((p) => (p.kind ?? "STOCK") === "STOCK")
      .map((p) => ({
        scrip: p.scrip,
        buyPrice: Number(p.avg) || 0,
        quantity: Math.abs(Number(p.qty)) || 0,
      })),
  };
}

export type ProfitRow = {
  scrip: string;
  ltp: number;
  profit: number;
  profitPerShare: number;
};

/**
 * Open-position P&L, marked against live Upstox quotes.
 *
 * Positions come from the derived ledger, not the dead legacy_books snapshot —
 * reading that table reported a permanent ₹0 for every real user. Quantity is
 * signed, so a short position profits when the price falls.
 */
export async function accountProfit(
  userId: string,
  email?: string | null,
): Promise<{
  overallProfit: number;
  profitArray: ProfitRow[];
}> {
  const rs = await runtimeSettings().catch(() => null);
  if (rs?.upstoxToken) setRuntimeToken(rs.upstoxToken);
  if (!hasUpstox() || rs?.providerOff)
    return { overallProfit: 0, profitArray: [] };

  const key = ledgerKeyFor(userId);
  await ensureAccount(key);
  const acct = deriveAccount(key, await marginPctFor(email));
  const open = acct.positions.filter(
    (p) => Number(p.qty) !== 0 && (p.kind ?? "STOCK") === "STOCK",
  );
  if (!open.length) return { overallProfit: 0, profitArray: [] };

  const symbols = [...new Set(open.map((p) => String(p.scrip).toUpperCase()))];
  const ltpBy: Record<string, number> = {};
  for (let i = 0; i < symbols.length; i += 10) {
    const chunk = symbols.slice(i, i + 10);
    try {
      const { data: ticks } = await cached(
        `profit:${chunk.join(",")}`,
        rs?.ttl?.quote || 5000,
        async () => {
          const keys = await Promise.all(chunk.map((s) => resolveUpstoxKey(s)));
          const quotes = await upstoxBatchQuotes(keys);
          return quotes
            .map((q, idx) => ({ symbol: chunk[idx], ltp: q.ltp }))
            .filter((t) => t.ltp > 0);
        },
      );
      for (const t of ticks as any[]) ltpBy[t.symbol] = t.ltp;
    } catch {
      /* skip chunk on failure */
    }
  }

  const profitArray: ProfitRow[] = [];
  let overallProfit = 0;
  for (const p of open) {
    const sym = String(p.scrip).toUpperCase();
    const ltp = ltpBy[sym];
    if (!ltp) continue;
    const perShare = ltp - Number(p.avg);
    const profit = perShare * Number(p.qty);
    profitArray.push({
      scrip: p.scrip,
      ltp,
      profit,
      profitPerShare: perShare,
    });
    overallProfit += profit;
  }
  return { overallProfit, profitArray };
}
