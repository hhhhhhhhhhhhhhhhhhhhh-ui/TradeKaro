// ─────────────────────────────────────────────────────────────────────────────
// Demo affiliate seeder
// ─────────────────────────────────────────────────────────────────────────────
//
// Creates an APPROVED partner account with a realistic book of business, so the
// whole panel — dashboard, links, stats, referrals, earnings, payouts — can be
// reviewed without waiting three weeks for holdbacks to elapse or asking
// somebody to deposit real money.
//
//   node scripts/seed-demo-affiliate.mjs <email> <password>
//   node scripts/seed-demo-affiliate.mjs --purge <email>
//
// Everything it writes is deterministic and tagged, so re-running it rebuilds
// the same numbers instead of stacking a second copy on top. `--purge` removes
// exactly what it created and nothing else.
//
// WHAT IT WRITES
//   • 1 affiliate, approved, on the hybrid plan (30% first deposit + 15% recurring)
//   • 8 demo traders, so referrals have real-looking client codes
//   • trade_deposits rows for those traders, so the numbers are backed by a ledger
//   • ~180 clicks spread over 45 days
//   • commission rows that mirror `attributeDeposit` exactly: 30% on the first
//     deposit, 15% on every deposit, 21-day holdback, so some rows are still
//     `pending` and the rest are `approved`
//   • one PAID payout and one rejected payout, for history
//
// ⚠️  Refuses to run against production, because it creates a login with a
//     known password and fake customers. That is fine on a laptop and dangerous
//     on a live platform.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync } from "node:crypto";

// ── arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const purgeOnly = argv[0] === "--purge";
const email = (purgeOnly ? argv[1] : argv[0] || "").trim().toLowerCase();
const password = purgeOnly ? "" : argv[1] || "";

if (!email) {
  console.error(
    "usage: node scripts/seed-demo-affiliate.mjs <email> <password>\n" +
      "       node scripts/seed-demo-affiliate.mjs --purge <email>",
  );
  process.exit(1);
}
if (!purgeOnly && password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error(
    "refusing to run with NODE_ENV=production — this creates a demo login with\n" +
      "a known password plus fake customers. Run it against a local or staging\n" +
      "database only.",
  );
  process.exit(1);
}

const db = new DatabaseSync("data/trade.db");
const DAY = 86400_000;
const now = Date.now();

// ── hashing (must match app/lib/affiliateAuth.ts + authStore.ts) ────────────
// The browser sends sha256(password) hex; the server scrypts that on top with a
// per-account salt. A seeded password has to go through both, or sign-in fails.

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const hashSecret = (clientHash, salt) =>
  scryptSync(clientHash, salt, 64).toString("hex");

const DEMO_CODE = "PT-DEMO01";
const DEMO_AFFILIATE_ID = "af_demo0000000000";

// ── the book of business ────────────────────────────────────────────────────
//
// Deposits drive everything below. `daysAgo` is per deposit so one customer can
// make a second deposit later — which is the whole point of the recurring share
// and produces the one commission row that is NOT a first-deposit rate.

const CUSTOMERS = [
  {
    n: 1,
    daysAgo: 44,
    landing: "start",
    campaign: "youtube-aug",
    deposits: [{ amount: 25000, daysAgo: 44 }],
  },
  {
    n: 2,
    daysAgo: 38,
    landing: "options",
    campaign: "youtube-aug",
    deposits: [{ amount: 10000, daysAgo: 38 }],
  },
  {
    n: 3,
    daysAgo: 30,
    landing: "start",
    campaign: "instagram-reel",
    deposits: [{ amount: 5000, daysAgo: 30 }],
  },
  {
    n: 4,
    daysAgo: 25,
    landing: "commodities",
    campaign: "telegram-group",
    deposits: [{ amount: 50000, daysAgo: 25 }],
  },
  {
    n: 5,
    daysAgo: 18,
    landing: "options",
    campaign: "instagram-reel",
    deposits: [{ amount: 15000, daysAgo: 18 }],
  },
  {
    n: 6,
    daysAgo: 12,
    landing: "start",
    campaign: "blog-seo",
    deposits: [
      { amount: 20000, daysAgo: 12 },
      { amount: 10000, daysAgo: 6 },
    ],
  },
  {
    n: 7,
    daysAgo: 4,
    landing: "options",
    campaign: "youtube-aug",
    deposits: [{ amount: 8000, daysAgo: 4 }],
  },
  {
    n: 8,
    daysAgo: 2,
    landing: "start",
    campaign: "telegram-group",
    deposits: [{ amount: 12000, daysAgo: 2 }],
  },
];

const PLAN = {
  depositRate: 30,
  revRate: 15,
  holdDays: 21,
  minPayout: 2000,
  name: "Pro Partner",
};

const clientId = (n) => `dmoclient${String(n).padStart(2, "0")}`;
const clientUser = (n) => `demo_client_${n}`;
const clientMail = (n) => `demo.client.${n}@demo.tradestox.local`;
const clientCode = (n) => `TK26DM00${n}`;

// ── purge ───────────────────────────────────────────────────────────────────

function purge() {
  const aff = db
    .prepare(`SELECT id FROM affiliates WHERE lower(email) = lower(?)`)
    .get(email);
  const id = aff ? String(aff.id) : DEMO_AFFILIATE_ID;

  db.prepare(`DELETE FROM affiliate_payouts WHERE affiliate_id = ?`).run(id);
  db.prepare(
    `DELETE FROM affiliate_payout_accounts WHERE affiliate_id = ?`,
  ).run(id);
  db.prepare(`DELETE FROM affiliate_commissions WHERE affiliate_id = ?`).run(
    id,
  );
  db.prepare(`DELETE FROM affiliate_referrals WHERE affiliate_id = ?`).run(id);
  db.prepare(`DELETE FROM affiliate_clicks WHERE code = ?`).run(DEMO_CODE);
  db.prepare(
    `DELETE FROM affiliates WHERE id = ? OR lower(email) = lower(?)`,
  ).run(id, email);

  // Only the demo customers, and only the deposits this script wrote. The
  // `demo-dep-` idem prefix is what makes that safe — clearing by user id alone
  // would take a real customer's ledger with it if an id ever collided.
  db.prepare(`DELETE FROM trade_deposits WHERE idem LIKE 'demo-dep-%'`).run();
  for (const c of CUSTOMERS) {
    db.prepare(`DELETE FROM watchlist WHERE user_id = ?`).run(clientId(c.n));
    db.prepare(`DELETE FROM users WHERE id = ?`).run(clientId(c.n));
  }

  return { id, existed: !!aff };
}

const purged = purge();
if (purgeOnly) {
  db.close();
  console.log(
    purged.existed
      ? `purged demo affiliate ${email} and ${CUSTOMERS.length} demo customers`
      : `no affiliate found for ${email}; demo customers and deposits removed`,
  );
  process.exit(0);
}

// ── affiliate ───────────────────────────────────────────────────────────────

const salt = randomBytes(16).toString("hex");
db.prepare(
  `INSERT INTO affiliates
     (id, code, name, email, phone, company, website, audience,
      pass_hash, salt, status, plan_id, model, deposit_rate, rev_rate, note,
      created_at, decided_at, decided_by, login_count, last_login)
   VALUES (?,?,?,?,?,?,?,?,?,?, 'approved', 'pl-pro', NULL, NULL, NULL, ?, ?, ?, 'demo-seed', 3, ?)`,
).run(
  DEMO_AFFILIATE_ID,
  DEMO_CODE,
  "Demo Partner",
  email,
  "9876500000",
  "Demo Media Network",
  "youtube.com/@demopartner",
  "Retail and options traders in India, reached through YouTube, Instagram Reels and a Telegram group.",
  hashSecret(sha256Hex(password), salt),
  salt,
  "Seeded demo account for reviewing the partner panel.",
  now - 60 * DAY,
  now - 59 * DAY,
  now - 3600_000,
);

// ── demo customers ──────────────────────────────────────────────────────────
//
// Real rows in `users` so the referrals list shows proper broker client codes.
// The password hash is scrypt of random bytes, so these accounts can never be
// signed into — they exist to be referred to, not logged in as.

const insertUser = db.prepare(
  `INSERT INTO users (id, username, email, phone, pass_hash, salt, created_at, client_code)
   VALUES (?,?,?,NULL,?,?,?,?)`,
);
for (const c of CUSTOMERS) {
  const s = randomBytes(16).toString("hex");
  insertUser.run(
    clientId(c.n),
    clientUser(c.n),
    clientMail(c.n),
    hashSecret(randomBytes(32).toString("hex"), s),
    s,
    now - c.daysAgo * DAY,
    clientCode(c.n),
  );
}

// ── clicks ──────────────────────────────────────────────────────────────────
//
// Deterministic pseudo-random so two runs produce the same chart. The wave keeps
// the bars from looking like a straight line; the ramp makes the account look
// like it is growing.

let seed = 20260919;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const insertClick = db.prepare(
  `INSERT INTO affiliate_clicks (code, ts, ip, ua, landing, campaign, referer, user_id)
   VALUES (?,?,?,?,?,?,?,NULL)`,
);
const PAGES = ["start", "options", "commodities"];
const CAMPAIGNS = [
  "youtube-aug",
  "instagram-reel",
  "telegram-group",
  "blog-seo",
];

let clickRows = 0;
for (let d = 44; d >= 0; d--) {
  // ~2–9 clicks a day, trending up, with a weekly wobble.
  const wave = 1 + Math.sin(d / 4);
  const ramp = (45 - d) / 45;
  const count = Math.max(
    1,
    Math.round(1.5 + wave * 1.4 + ramp * 3.5 + rnd() * 1.6),
  );
  for (let k = 0; k < count; k++) {
    const landing = PAGES[Math.floor(rnd() * PAGES.length)];
    const campaign = CAMPAIGNS[Math.floor(rnd() * CAMPAIGNS.length)];
    insertClick.run(
      DEMO_CODE,
      now - d * DAY + Math.floor(rnd() * 20) * 3600_000,
      "203.0.113.0",
      "Mozilla/5.0 (demo seed)",
      landing,
      campaign,
      "https://www.google.com/",
    );
    clickRows++;
  }
}

// ── referrals, deposits and commissions ─────────────────────────────────────
//
// The commission rules are copied from `attributeDeposit` on purpose, and the
// duplication is the point: a demo that credits a different amount from the real
// thing is worse than no demo. Hybrid means 30% on the FIRST deposit and 15% on
// EVERY deposit. A commission is `pending` while its 21-day holdback is open and
// `approved` after that — which is what `releaseDue()` would do on first read.

const insertDeposit = db.prepare(
  `INSERT INTO trade_deposits (user_id, ts, amount, method, actor, note, idem)
   VALUES (?,?,?, 'gateway', 'demo-seed', 'demo seed', ?)`,
);
const insertRef = db.prepare(
  `INSERT INTO affiliate_referrals
     (user_id, affiliate_id, code, landing, campaign, deposited, reversed, created_at)
   VALUES (?,?,?,?,?,?,0,?)`,
);
// The commission ledger records the terms each row was earned under, and the
// ledger row that produced it, so a SEEDED commission is auditable and
// reconcilable by the same engine that audits the live ones. `idem` uses the
// same `dep:<depositId>:<tag>` shape the live path writes — if the seed invented
// its own shape, reconciliation would report every demo commission as missing.
const insertCommission = db.prepare(
  `INSERT INTO affiliate_commissions
     (affiliate_id, user_id, source, idem, base_amount, rate, amount,
      status, hold_until, created_at, decided_at, decided_by, note,
      model, plan_id, hold_days, deposit_id, earned_at, reconciled)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
);

const round2 = (n) => Math.round(n * 100) / 100;
let totals = { deposited: 0, earned: 0, pending: 0 };
// Counted, not inferred. The first version printed `rows - 1` for "still in
// holdback" and was simply wrong: a customer who deposited 18 days ago is still
// inside a 21-day window, so five rows were pending, not one.
let commissionRows = 0;
let releasedRows = 0;
let pendingRows = 0;

for (const c of CUSTOMERS) {
  const uid = clientId(c.n);
  const joinedAt = now - c.daysAgo * DAY;
  const deposited = c.deposits.reduce((n, d) => n + d.amount, 0);
  insertRef.run(
    uid,
    DEMO_AFFILIATE_ID,
    DEMO_CODE,
    c.landing,
    c.campaign,
    deposited,
    joinedAt,
  );

  c.deposits.forEach((dep, i) => {
    const ts = now - dep.daysAgo * DAY;
    const holdUntil = ts + PLAN.holdDays * DAY;
    const released = holdUntil <= now;
    // `trade_deposits` keys money on `u-<id>`; the affiliate tables key on the
    // bare id. This used to write the BARE id into the ledger, which made every
    // demo deposit invisible to the commission engine (so reconciliation would
    // read the cached totals as drift and zero them) and to the trader app's own
    // funding totals. It now uses the same key the live path does.
    const depRes = insertDeposit.run(
      `u-${uid}`,
      ts,
      dep.amount,
      `demo-dep-${c.n}-${i}`,
    );
    const depositId = Number(depRes.lastInsertRowid);

    const add = (rate, kind, tag) => {
      const amount = round2(dep.amount * (rate / 100));
      insertCommission.run(
        DEMO_AFFILIATE_ID,
        uid,
        tag,
        `dep:${depositId}:${tag}`,
        dep.amount,
        rate,
        amount,
        released ? "approved" : "pending",
        holdUntil,
        ts,
        released ? holdUntil : null,
        released ? "demo-seed" : null,
        kind,
        PLAN.model || "hybrid",
        "pl-std",
        PLAN.holdDays,
        depositId,
        ts,
      );
      commissionRows++;
      if (released) releasedRows++;
      else pendingRows++;
      totals.earned += amount;
      if (!released) totals.pending += amount;
    };

    if (i === 0) add(PLAN.depositRate, "Deposit %", "first");
    add(PLAN.revRate, "Recurring share", "recur");
  });

  totals.deposited += deposited;

  // Mark a click from the matching page as the one that converted, so the
  // click→signup funnel is not off by the difference between the two.
  db.prepare(
    `UPDATE affiliate_clicks SET user_id = ?
      WHERE id = (SELECT id FROM affiliate_clicks
                   WHERE code = ? AND landing = ? AND user_id IS NULL
                     AND ts <= ? ORDER BY ts DESC LIMIT 1)`,
  ).run(uid, DEMO_CODE, c.landing, joinedAt);
}

// ── payout destination and history ──────────────────────────────────────────

const accountId = "pa_demo0000000000";
db.prepare(
  `INSERT INTO affiliate_payout_accounts
     (id, affiliate_id, kind, label, holder, upi_id, account_tail, ifsc,
      bank_name, usdt_address, usdt_network, is_default, created_at)
   VALUES (?,?, 'upi', 'Primary', ?, ?, '', '', '', '', '', 1, ?)`,
).run(
  accountId,
  DEMO_AFFILIATE_ID,
  "Demo Partner",
  "demopartner@okhdfcbank",
  now - 55 * DAY,
);

// One payout already sent, and one that was refused — so the history shows real
// outcomes (including the reason, which is the part a partner actually needs)
// instead of a single happy row.
db.prepare(
  `INSERT INTO affiliate_payouts
     (id, affiliate_id, amount, method, account_id, destination, status, note, utr,
      requested_at, decided_at, decided_by, updated_at)
   VALUES (?,?,?, 'upi', ?, ?, 'paid', '', 'UTR2508190001', ?, ?, 'demo-seed', ?)`,
).run(
  "PO-DEMO0001",
  DEMO_AFFILIATE_ID,
  25000,
  accountId,
  "UPI · demopartner@okhdfcbank",
  now - 30 * DAY,
  now - 29 * DAY,
  now - 29 * DAY,
);
db.prepare(
  `INSERT INTO affiliate_payouts
     (id, affiliate_id, amount, method, account_id, destination, status, note, utr,
      requested_at, decided_at, decided_by, updated_at)
   VALUES (?,?,?, 'upi', ?, ?, 'rejected', ?, NULL, ?, ?, 'demo-seed', ?)`,
).run(
  "PO-DEMO0002",
  DEMO_AFFILIATE_ID,
  2500,
  accountId,
  "UPI · demopartner@okhdfcbank",
  "The bank rejected this UPI ID. Please add a different one and request again.",
  now - 48 * DAY,
  now - 47 * DAY,
  now - 47 * DAY,
);

db.close();

// ── report ──────────────────────────────────────────────────────────────────
//
// Printed in the same shape the panel shows, so what you read here can be
// checked against the screen. If these two ever disagree, one of them is wrong
// and that is worth knowing before anybody signs in.

const paidPayouts = 25000; // the 'paid' row above; the rejected one is not money
const committed = paidPayouts;
const approved = totals.earned - totals.pending;
const available = Math.max(0, approved - committed);

const inr = (n) => `₹${n.toLocaleString("en-IN")}`;

console.log(`
  Demo affiliate ready
  ─────────────────────────────────────────────────────────
  Sign in   http://localhost:3000/partners/login
  Email     ${email}
  Password  ${password}
  Code      ${DEMO_CODE}

  Dashboard should read
    lifetime earned   ${inr(totals.earned)}
    in holdback       ${inr(totals.pending)}
    paid to date      ${inr(paidPayouts)}
    available         ${inr(available)}
    customer deposits ${inr(totals.deposited)}
    clicks / signups  ${clickRows} / ${CUSTOMERS.length}
    commission rows   ${commissionRows} (${releasedRows} released, ${pendingRows} in holdback)

  Rebuild or remove
    node scripts/seed-demo-affiliate.mjs ${email} <password>
    node scripts/seed-demo-affiliate.mjs --purge ${email}
`);
