import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { runtimeSettings } from "@/app/lib/adminRuntime";
import { depositedTotals } from "@/app/lib/deposits";
import { legKey } from "@/app/lib/positionKeys";
import { adminFrom, deny } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Platform analytics ─────────────────────────────────────────────────────
// Read-only aggregates over data the app was ALREADY storing but never reading:
// the authoritative trade_fills ledger, the client heartbeat registry, and the
// new trade_rejects table.
//
// The most valuable column here is trade_fills.ref_price — the validated live
// market price the server recorded next to every fill. Because a fill is only
// accepted within 3% of it, that column is a trusted execution benchmark, which
// is what makes the slippage panel possible with no extra instrumentation.

const IST_SEC = 19800; // +05:30, no DST
const DAY = 86_400_000;

function rows<T = any>(sql: string, ...params: any[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function one<T = any>(sql: string, ...params: any[]): T {
  return (rows<T>(sql, ...params)[0] ?? {}) as T;
}

/** Epoch ms of the most recent 00:00 IST. */
function istDayStart(now: number): number {
  const ist = new Date(now + IST_SEC * 1000);
  return (
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) -
    IST_SEC * 1000
  );
}

/** Epoch ms of the most recent Monday 00:00 IST — cohort bucketing key. */
function istWeekStart(ts: number): number {
  const ist = new Date(ts + IST_SEC * 1000);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  return (
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) -
    dow * 86_400_000 -
    IST_SEC * 1000
  );
}

type Fill = {
  user_id: string;
  ts: number;
  symbol: string;
  product: string | null;
  side: string;
  qty: number;
  price: number;
  value: number;
  charges: number;
  ref_price: number | null;
};

/**
 * Positions are keyed by `symbol` + product, never by symbol alone.
 *
 * ⚠️ This walk used to key them by `f.symbol`, which silently MERGED a CNC leg
 * and an MIS leg of the same scrip into one row. That mis-states realised P&L,
 * exposure and free margin for exactly the customers who hold both — and it made
 * this panel disagree with `deriveAccount`, which every portfolio page uses.
 * `platformMoney()` on the dashboard walks the same ledger with the same rule,
 * so the two must stay on `legKey` or they start contradicting each other.
 */
const legOf = (f: { symbol: string; product: string | null }) =>
  legKey(f.symbol, f.product);

/** The scrip half of a leg key, for the per-symbol aggregate. */
const scripOf = (key: string) => key.split("\u0000")[0];

type ClientRisk = {
  id: string;
  exposure: number;
  marginUsed: number;
  freeMargin: number;
  ledger: number;
  positions: number;
  realized: number;
  realizedToday: number;
  deposited: number;
  mtm: number;
  pct: number;
};

/**
 * Derive every client's book from the append-only ledger in ONE pass.
 *
 * Re-implements `deriveAccount` rather than calling it per user (which would be
 * one query per account). The accounting mirrors it exactly — average-cost
 * positions, realised P&L counted only on fully-closed scrips as net cash flow,
 * exposure at entry price, and `free = startCash + realised − charges −
 * marginUsed`. If those definitions drift, this panel starts disagreeing with
 * the client and the Funds tab.
 *
 * Exposure and realised are carried incrementally so the whole walk is O(fills)
 * rather than O(fills × positions).
 */
function deriveRisk(
  fills: Fill[],
  startCash: Map<string, number>,
  deposits: Map<string, number>,
  pcts: Map<string, number>,
  defaultPct: number,
  todayStart: number,
) {
  // Latest validated market price per symbol — used only to mark open positions.
  const mark = new Map<string, number>();
  for (const f of fills)
    mark.set(
      f.symbol,
      Number(f.ref_price) > 0 ? Number(f.ref_price) : Number(f.price),
    );

  type State = {
    pos: Map<string, { qty: number; avg: number }>;
    byScrip: Map<string, number>;
    exposure: number;
    realized: number;
    realizedToday: number;
    deposited: number;
    charges: number;
    wallet: number;
    pct: number;
    start: number;
  };
  const perUser = new Map<string, State>();

  for (const f of fills) {
    let s = perUser.get(f.user_id);
    if (!s) {
      const pct = pcts.get(f.user_id) ?? defaultPct;
      const start = startCash.get(f.user_id) ?? 0;
      s = {
        pos: new Map(),
        byScrip: new Map(),
        exposure: 0,
        realized: 0,
        realizedToday: 0,
        deposited: deposits.get(f.user_id) ?? 0,
        charges: 0,
        wallet: start,
        pct,
        start,
      };
      perUser.set(f.user_id, s);
    }

    const qty = Math.abs(Number(f.qty));
    const price = Number(f.price);
    const val = Number(f.value) || qty * price;
    const delta = f.side === "BUY" ? qty : -qty;

    // ── average-cost position ──
    const leg = legOf(f);
    const p = s.pos.get(leg) ?? { qty: 0, avg: 0 };
    const before = Math.abs(p.qty) * p.avg;
    if (p.qty === 0) {
      p.qty = delta;
      p.avg = price;
    } else if (Math.sign(delta) === Math.sign(p.qty)) {
      const absOld = Math.abs(p.qty);
      const absNew = Math.abs(p.qty + delta);
      // Only ADDED units move the average (the partial-exit fix).
      if (absNew > absOld) p.avg = (absOld * p.avg + qty * price) / absNew;
      p.qty += delta;
    } else {
      const flipped = Math.sign(p.qty + delta) !== Math.sign(p.qty);
      p.qty += delta;
      if (flipped && p.qty !== 0) p.avg = price;
    }
    const after = p.qty === 0 ? 0 : Math.abs(p.qty) * p.avg;
    s.exposure += after - before;

    // ── realised P&L: net cash per scrip, banked when the scrip goes flat ──
    const net = (s.byScrip.get(leg) || 0) + (f.side === "SELL" ? val : -val);
    if (p.qty === 0) {
      s.realized += net;
      if (f.ts >= todayStart) s.realizedToday += net;
      s.byScrip.delete(leg);
      s.pos.delete(leg);
    } else {
      s.byScrip.set(leg, net);
      s.pos.set(leg, p);
    }

    s.charges += Number(f.charges) || 0;

    // ── running wallet, exactly as the client computes it ──
    const marginUsed = (s.exposure * s.pct) / 100;
    s.wallet = s.start + s.realized - s.charges - marginUsed;
  }

  const clients: ClientRisk[] = [];
  const symbolAgg = new Map<
    string,
    {
      accounts: number;
      longQty: number;
      shortQty: number;
      longNotional: number;
      shortNotional: number;
      notional: number;
    }
  >();

  for (const [id, s] of perUser) {
    let mtm = 0;
    for (const [leg, p] of s.pos) {
      const scrip = scripOf(leg);
      const px = mark.get(scrip) ?? p.avg;
      mtm += (px - p.avg) * p.qty;

      const a = symbolAgg.get(scrip) ?? {
        accounts: 0,
        longQty: 0,
        shortQty: 0,
        longNotional: 0,
        shortNotional: 0,
        notional: 0,
      };
      a.accounts++;
      const n = Math.abs(p.qty) * px;
      if (p.qty > 0) {
        a.longQty += p.qty;
        a.longNotional += n;
      } else {
        a.shortQty += -p.qty;
        a.shortNotional += n;
      }
      a.notional += n;
      symbolAgg.set(scrip, a);
    }
    const marginUsed = (s.exposure * s.pct) / 100;
    clients.push({
      id,
      exposure: s.exposure,
      marginUsed,
      freeMargin: s.wallet,
      ledger: s.wallet + marginUsed,
      positions: s.pos.size,
      realized: s.realized,
      realizedToday: s.realizedToday,
      deposited: s.deposited,
      mtm,
      pct: s.pct,
    });
  }

  return { clients, symbolAgg };
}

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();

  const now = Date.now();
  const today = istDayStart(now);
  const d7 = now - 7 * DAY;
  const d14 = now - 14 * DAY;
  const d30 = now - 30 * DAY;

  // ── accounts ──
  const users = one<{
    total: number;
    new_today: number;
    new_7d: number;
    new_30d: number;
  }>(
    `SELECT count(*) AS total,
        sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_today,
        sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
        sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d
     FROM users`,
    today,
    d7,
    d30,
  );

  // ── ledger ──
  const trading = one<{
    fills: number;
    turnover: number;
    charges: number;
    fills_today: number;
    turnover_today: number;
    charges_today: number;
    traders: number;
    traders_today: number;
    avg_ticket: number;
  }>(
    `SELECT count(*) AS fills,
        coalesce(sum(value),0)   AS turnover,
        coalesce(sum(charges),0) AS charges,
        sum(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS fills_today,
        coalesce(sum(CASE WHEN ts >= ? THEN value ELSE 0 END),0)   AS turnover_today,
        coalesce(sum(CASE WHEN ts >= ? THEN charges ELSE 0 END),0) AS charges_today,
        count(DISTINCT user_id) AS traders,
        count(DISTINCT CASE WHEN ts >= ? THEN user_id END) AS traders_today,
        coalesce(avg(value),0)  AS avg_ticket
     FROM trade_fills`,
    today,
    today,
    today,
    today,
  );

  // ── last 14 days, bucketed by IST calendar day ──
  const daily = rows<{
    day: string;
    fills: number;
    turnover: number;
    charges: number;
    traders: number;
  }>(
    `SELECT date((ts/1000) + ?, 'unixepoch') AS day,
            count(*) AS fills,
            coalesce(sum(value),0) AS turnover,
            coalesce(sum(charges),0) AS charges,
            count(DISTINCT user_id) AS traders
     FROM trade_fills WHERE ts >= ?
     GROUP BY day ORDER BY day`,
    IST_SEC,
    d14,
  );

  // ── activity by IST hour, last 30 days ──
  const hours = rows<{ h: string; n: number }>(
    `SELECT strftime('%H', (ts/1000) + ?, 'unixepoch') AS h, count(*) AS n
     FROM trade_fills WHERE ts >= ?
     GROUP BY h ORDER BY h`,
    IST_SEC,
    d30,
  );

  // ── what people actually trade ──
  const topSymbols = rows<{
    symbol: string;
    fills: number;
    value: number;
    traders: number;
  }>(
    `SELECT symbol, count(*) AS fills, coalesce(sum(value),0) AS value,
            count(DISTINCT user_id) AS traders
     FROM trade_fills WHERE ts >= ?
     GROUP BY symbol ORDER BY fills DESC LIMIT 12`,
    d30,
  );

  const productMix = rows<{
    product: string;
    fills: number;
    value: number;
  }>(
    `SELECT coalesce(product,'—') AS product, count(*) AS fills,
            coalesce(sum(value),0) AS value
     FROM trade_fills GROUP BY product ORDER BY fills DESC`,
  );

  // ── execution quality: fill price vs the server's validated reference ──
  // Signed so positive = adverse (paid above / sold below the benchmark).
  const dev = `CASE WHEN side='BUY' THEN (price - ref_price) ELSE (ref_price - price) END / ref_price * 10000`;
  const slip = one<{
    n: number;
    avg_bps: number;
    worst_bps: number;
    best_bps: number;
  }>(
    `SELECT count(*) AS n,
            coalesce(avg(${dev}),0) AS avg_bps,
            coalesce(max(${dev}),0) AS worst_bps,
            coalesce(min(${dev}),0) AS best_bps
     FROM trade_fills WHERE ref_price IS NOT NULL AND ref_price > 0`,
  );
  const slipBuckets = one<{
    fav: number;
    b0: number;
    b5: number;
    b15: number;
    b30: number;
    b60: number;
  }>(
    `SELECT
       sum(CASE WHEN d < 0 THEN 1 ELSE 0 END) AS fav,
       sum(CASE WHEN d >= 0  AND d < 5  THEN 1 ELSE 0 END) AS b0,
       sum(CASE WHEN d >= 5  AND d < 15 THEN 1 ELSE 0 END) AS b5,
       sum(CASE WHEN d >= 15 AND d < 30 THEN 1 ELSE 0 END) AS b15,
       sum(CASE WHEN d >= 30 AND d < 60 THEN 1 ELSE 0 END) AS b30,
       sum(CASE WHEN d >= 60 THEN 1 ELSE 0 END) AS b60
     FROM (SELECT ${dev} AS d FROM trade_fills
           WHERE ref_price IS NOT NULL AND ref_price > 0)`,
  );

  // ── funnel ──
  const activated = one<{ n: number }>(
    "SELECT count(DISTINCT user_id) AS n FROM trade_fills",
  ).n;
  const retained = one<{ n: number }>(
    "SELECT count(DISTINCT user_id) AS n FROM trade_fills WHERE ts >= ?",
    d7,
  ).n;
  const heavy = one<{ n: number }>(
    `SELECT count(*) AS n FROM (
       SELECT user_id FROM trade_fills GROUP BY user_id HAVING count(*) >= 5)`,
  ).n;

  // ── heartbeat registry (activity lives in the JSON blob) ──
  // The registry only contains rows for browsers that actually POSTed a
  // heartbeat, so "never signed in" has to be an INTERSECTION with real user
  // ids. Counting registry rows told every account it had signed in whenever
  // the registry was empty.
  const clientRows = rows<{ json: string }>(
    "SELECT json FROM blocks WHERE kind = 'clients'",
  );
  const userIds = new Set(
    rows<{ id: string }>("SELECT id FROM users").map((u) => String(u.id)),
  );
  const seen = new Set<string>();
  let liveNow = 0;
  let dau = 0;
  let wau = 0;
  let mau = 0;
  let logins = 0;
  for (const c of clientRows) {
    let r: any;
    try {
      r = JSON.parse(c.json);
    } catch {
      continue;
    }
    logins += Number(r?.loginCount) || 0;
    const ls = Number(r?.lastSeen) || 0;
    if (!ls) continue;
    // The registry keys by the same id/ clientID the account uses.
    for (const k of [r?.id, r?.clientID]) {
      const id = String(k || "");
      if (id && userIds.has(id)) seen.add(id);
    }
    const age = now - ls;
    if (age <= 5 * 60_000) liveNow++;
    if (ls >= today) dau++;
    if (age <= 7 * DAY) wau++;
    if (age <= 30 * DAY) mau++;
  }
  const signedIn = seen.size;
  const neverSignedIn = Math.max(0, (users.total || 0) - signedIn);

  // ── rejections ──
  const rej = one<{ total: number; last7: number; today: number }>(
    `SELECT count(*) AS total,
            sum(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last7,
            sum(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS today
     FROM trade_rejects`,
    d7,
    today,
  );
  const rejByReason = rows<{ reason: string; n: number; last: number }>(
    `SELECT reason, count(*) AS n, max(at) AS last
     FROM trade_rejects GROUP BY reason ORDER BY n DESC`,
  );
  const rejRecent = rows<{
    at: number;
    reason: string;
    symbol: string;
    side: string;
    qty: number;
    price: number;
    status: number;
  }>(
    `SELECT at, reason, symbol, side, qty, price, status
     FROM trade_rejects ORDER BY at DESC LIMIT 12`,
  );

  // ── risk: one pass over the whole ledger ──
  // Capped so a pathological ledger cannot hang the admin console. When the cap
  // trips, per-client figures are incomplete, so say so rather than pretending.
  const CAP = 250_000;
  // ⚠️ `id` is part of the ordering, not decoration. Realised P&L is banked the
  // moment a leg goes FLAT, so the sequence matters: two fills stamped in the
  // same millisecond applied in the other order can bank a different number.
  // `deriveAccount` reads the ledger with exactly this ordering (see `fillsFor`),
  // and this panel has to agree with the page every customer is looking at.
  const allFills = rows<Fill>(
    `SELECT user_id, ts, symbol, product, side, qty, price, value, charges, ref_price
     FROM trade_fills ORDER BY user_id, ts, id LIMIT ?`,
    CAP,
  );
  const truncated = allFills.length >= CAP;

  let defaultPct = 100;
  try {
    const rs = await runtimeSettings();
    const n = Number(rs.trading?.marginPct);
    if (Number.isFinite(n) && n >= 1 && n <= 100) defaultPct = n;
  } catch {
    /* keep the 100% fallback — full payment, never accidentally more leverage */
  }

  // Capital = seeded virtual cash + everything the user has deposited, which is
  // exactly how tradingServer.tradingCapital() derives it. Counting only the seed
  // would understate every funded account's free margin.
  const startCash = new Map<string, number>();
  for (const r of rows<{ user_id: string; start_cash: number }>(
    "SELECT user_id, start_cash FROM trade_accounts",
  ))
    startCash.set(String(r.user_id), Number(r.start_cash) || 0);
  const deposited = depositedTotals();
  for (const [key, amt] of deposited)
    startCash.set(key, (startCash.get(key) ?? 0) + amt);

  const userMeta = new Map<string, { username: string; email: string }>();
  for (const u of rows<{ id: string; username: string; email: string }>(
    "SELECT id, username, email FROM users",
  ))
    userMeta.set(String(u.id), {
      username: String(u.username || ""),
      email: String(u.email || ""),
    });

  // Per-user margin override, keyed the same way the registry stores it.
  const pcts = new Map<string, number>();
  const emailPct = new Map<string, number>();
  for (const c of clientRows) {
    let r: any;
    try {
      r = JSON.parse(c.json);
    } catch {
      continue;
    }
    const n = Number(r?.marginPct);
    if (!Number.isFinite(n) || n < 1 || n > 100) continue;
    for (const k of [r?.id, r?.clientID]) if (k) pcts.set(String(k), n);
    if (r?.email) emailPct.set(String(r.email).toLowerCase(), n);
  }
  // `trade_fills.user_id` is `u-<users.id>` (paperKeyFor), so strip the prefix
  // before looking anything up.
  for (const [id, meta] of userMeta) {
    const e = emailPct.get(meta.email.toLowerCase());
    if (e !== undefined) pcts.set(`u-${id}`, e);
  }

  const { clients, symbolAgg } = deriveRisk(
    allFills,
    startCash,
    deposited,
    pcts,
    defaultPct,
    today,
  );

  const withPositions = clients.filter((c) => c.positions > 0);
  const riskTotals = clients.reduce(
    (a, c) => {
      a.exposure += c.exposure;
      a.marginUsed += c.marginUsed;
      a.freeMargin += c.freeMargin;
      a.mtm += c.mtm;
      a.realized += c.realized;
      a.deposited += c.deposited;
      a.openPositions += c.positions;
      return a;
    },
    {
      exposure: 0,
      marginUsed: 0,
      freeMargin: 0,
      mtm: 0,
      realized: 0,
      deposited: 0,
      openPositions: 0,
    },
  );

  const nameOf = (key: string) => {
    const id = key.startsWith("u-") ? key.slice(2) : key;
    const m = userMeta.get(id);
    return m?.username || m?.email || id.slice(0, 10) || "unknown";
  };

  const totalNotional = [...symbolAgg.values()].reduce(
    (a, s) => a + s.notional,
    0,
  );
  const bySymbol = [...symbolAgg.entries()]
    .map(([symbol, s]) => ({
      symbol,
      accounts: s.accounts,
      longQty: s.longQty,
      shortQty: s.shortQty,
      netQty: s.longQty - s.shortQty,
      notional: s.notional,
      sharePct: totalNotional > 0 ? (s.notional / totalNotional) * 100 : 0,
    }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 12);

  const topClients = [...clients]
    .sort((a, b) => b.exposure - a.exposure)
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      name: nameOf(c.id),
      exposure: c.exposure,
      marginUsed: c.marginUsed,
      freeMargin: c.freeMargin,
      ledger: c.ledger,
      utilPct: c.ledger > 0 ? (c.marginUsed / c.ledger) * 100 : 0,
      positions: c.positions,
      realized: c.realized,
      realizedToday: c.realizedToday,
      deposited: c.deposited,
      mtm: c.mtm,
      pct: c.pct,
    }));

  const longNotional = [...symbolAgg.values()].reduce(
    (a, s) => a + s.longNotional,
    0,
  );
  const shortNotional = [...symbolAgg.values()].reduce(
    (a, s) => a + s.shortNotional,
    0,
  );

  // ── cohort retention by IST signup week ──
  const cohortOf = new Map<string, number>();
  for (const u of rows<{ id: string; created_at: number }>(
    "SELECT id, created_at FROM users",
  ))
    cohortOf.set(String(u.id), istWeekStart(Number(u.created_at) || 0));

  const traded = new Map<number, Map<number, Set<string>>>(); // cohort -> offset -> users
  for (const f of allFills) {
    const id = f.user_id.startsWith("u-") ? f.user_id.slice(2) : f.user_id;
    const c = cohortOf.get(id);
    if (c === undefined) continue;
    const off = Math.round((istWeekStart(f.ts) - c) / (7 * 86_400_000));
    if (off < 0) continue;
    let byOff = traded.get(c);
    if (!byOff) {
      byOff = new Map();
      traded.set(c, byOff);
    }
    let set = byOff.get(off);
    if (!set) {
      set = new Set();
      byOff.set(off, set);
    }
    set.add(id);
  }

  const cohortKeys = [...new Set([...cohortOf.values()])]
    .sort((a, b) => b - a)
    .slice(0, 6);
  const cohorts = cohortKeys.map((c) => {
    const members = [...cohortOf.entries()]
      .filter(([, v]) => v === c)
      .map(([k]) => k);
    const size = members.length;
    const byOff = traded.get(c) ?? new Map<number, Set<string>>();
    const offsets = [0, 1, 2, 3, 4].map((o) => {
      const set = byOff.get(o);
      const n = set ? members.filter((m) => set.has(m)).length : 0;
      return { offset: o, n, pct: size > 0 ? (n / size) * 100 : 0 };
    });
    return {
      weekStart: c,
      label: new Date(c).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }),
      size,
      offsets,
    };
  });

  return NextResponse.json({
    at: now,
    accounts: {
      newToday: users.new_today || 0,
      new7d: users.new_7d || 0,
      new30d: users.new_30d || 0,
      neverSignedIn,
      signedIn,
    },
    activity: { liveNow, dau, wau, mau, logins },
    funnel: {
      registered: users.total || 0,
      activated: activated || 0,
      retained: retained || 0,
      heavy: heavy || 0,
      neverTraded: Math.max(0, (users.total || 0) - (activated || 0)),
    },
    trading: {
      fills: trading.fills || 0,
      turnover: trading.turnover || 0,
      charges: trading.charges || 0,
      fillsToday: trading.fills_today || 0,
      turnoverToday: trading.turnover_today || 0,
      chargesToday: trading.charges_today || 0,
      traders: trading.traders || 0,
      tradersToday: trading.traders_today || 0,
      avgTicket: trading.avg_ticket || 0,
    },
    daily,
    hours: hours.map((h) => ({ hour: Number(h.h), fills: h.n })),
    topSymbols,
    productMix,
    slippage: {
      samples: slip.n || 0,
      avgBps: slip.avg_bps || 0,
      worstBps: slip.worst_bps || 0,
      bestBps: slip.best_bps || 0,
      buckets: [
        { label: "Better than ref", n: slipBuckets.fav || 0, tone: "up" },
        { label: "0–5 bps", n: slipBuckets.b0 || 0, tone: "muted" },
        { label: "5–15 bps", n: slipBuckets.b5 || 0, tone: "muted" },
        { label: "15–30 bps", n: slipBuckets.b15 || 0, tone: "warn" },
        { label: "30–60 bps", n: slipBuckets.b30 || 0, tone: "warn" },
        { label: "60+ bps", n: slipBuckets.b60 || 0, tone: "down" },
      ],
    },
    rejects: {
      total: rej.total || 0,
      last7: rej.last7 || 0,
      today: rej.today || 0,
      byReason: rejByReason,
      recent: rejRecent,
    },
    risk: {
      truncated,
      defaultPct,
      totals: {
        ...riskTotals,
        openClients: withPositions.length,
        longNotional,
        shortNotional,
        netNotional: longNotional - shortNotional,
      },
      bySymbol,
      topClients,
    },
    cohorts,
  });
}
