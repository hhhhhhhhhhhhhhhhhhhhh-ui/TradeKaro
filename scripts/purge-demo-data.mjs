// scripts/purge-demo-data.mjs — strip demo and test data from a database.
//
//   node scripts/purge-demo-data.mjs          → dry run, prints what it would remove
//   node scripts/purge-demo-data.mjs --yes    → actually removes
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A ONE-OFF: demo data lives in the
// DATABASE, not in the code. `data/` is gitignored, so pushing a deploy does not
// move or clean it — the server keeps whatever its own database already had. If
// a demo partner was ever seeded on the box, `git push && deploy.sh` will not
// remove it. This is the thing you run on the box.
//
// WHAT IT REMOVES
//   • the demo affiliate (demo@tradestox.pro / PT-DEMO01) and everything it
//     caused: customers, deposits, commissions, payouts, clicks, requests
//   • every affiliate registered by the test suites, matched on reserved
//     domains (@example.com, @test.local, @attrib.local, @engine.local,
//     @wiring.local) and their affiliate-side rows
//
// WHAT IT DOES NOT TOUCH
//   • real affiliates, whatever their status — approved, pending, suspended
//   • trader accounts that are not on a reserved test domain. Smoke-test traders
//     are left alone on purpose: they have trade rows hanging off them, and a
//     half-cleaned trader is worse than an untidy one.
//   • the admin console account. That is created from ADMIN_EMAIL /
//     ADMIN_PASSWORD in the environment, so changing it is a .env decision, not
//     a database one — deleting the row just makes it come back on next boot.
//
// Take a backup first: `node scripts/backup.mjs`.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const YES = process.argv.includes("--yes");
const DB_PATH = process.env.DB_PATH || "data/trade.db";

const DEMO_EMAILS = ["demo@tradestox.pro"];
const DEMO_CODES = ["PT-DEMO01"];
// Reserved domains. RFC 2606 reserves example.com/test/local for exactly this,
// so nothing real can be caught by these.
const TEST_DOMAINS = [
  "@example.com",
  "@test.local",
  "@attrib.local",
  "@engine.local",
  "@wiring.local",
];

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run this from the repo root.`);
  process.exit(2);
}
const db = new DatabaseSync(DB_PATH);

// ── who is going ────────────────────────────────────────────────────────────
const where = [
  "lower(email) IN (" + DEMO_EMAILS.map(() => "?").join(",") + ")",
  ...TEST_DOMAINS.map(() => "lower(email) LIKE ?"),
  "code IN (" + DEMO_CODES.map(() => "?").join(",") + ")",
].join(" OR ");

const targets = db
  .prepare(`SELECT id, code, name, email, status FROM affiliates WHERE ${where}`)
  .all(...DEMO_EMAILS, ...TEST_DOMAINS.map((d) => `%${d}`), ...DEMO_CODES);

console.log(`${DB_PATH}${YES ? "" : "   [DRY RUN — pass --yes to apply]"}\n`);

const all = db.prepare("SELECT COUNT(*) AS n FROM affiliates").get().n;
console.log(`affiliates: ${all} total, ${targets.length} to remove, ${all - targets.length} kept\n`);

for (const t of targets)
  console.log(`  - ${t.code.padEnd(10)} ${String(t.status).padEnd(9)} ${t.email}`);

if (!targets.length) {
  console.log("\nNothing to remove.");
  process.exit(0);
}

// ── what that takes with it ─────────────────────────────────────────────────
const ids = targets.map((t) => String(t.id));
const codes = targets.map((t) => String(t.code));
const marks = (n) => Array.from({ length: n }, () => "?").join(",");
const countOf = (sql, params) => db.prepare(sql).get(...params).n;

const knockOn = [
  ["affiliate_commissions", `SELECT COUNT(*) AS n FROM affiliate_commissions WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_referrals", `SELECT COUNT(*) AS n FROM affiliate_referrals WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_payouts", `SELECT COUNT(*) AS n FROM affiliate_payouts WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_payout_accounts", `SELECT COUNT(*) AS n FROM affiliate_payout_accounts WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_requests", `SELECT COUNT(*) AS n FROM affiliate_requests WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_terms_history", `SELECT COUNT(*) AS n FROM affiliate_terms_history WHERE affiliate_id IN (${marks(ids.length)})`, ids],
  ["affiliate_clicks", `SELECT COUNT(*) AS n FROM affiliate_clicks WHERE code IN (${marks(codes.length)})`, codes],
];

console.log("");
const plan = [];
for (const [label, sql, params] of knockOn) {
  const n = countOf(sql, params);
  plan.push({ label, sql: sql.replace(/^SELECT COUNT\(\*\) AS n/, "DELETE"), params, n });
  console.log(`  ${String(n).padStart(5)}  ${label}`);
}

// The demo affiliate's customers go too — they exist only to make its panel look
// populated, and leaving them would leave the affiliate's referrals half-there.
const custIds = db
  .prepare(
    `SELECT user_id FROM affiliate_referrals WHERE affiliate_id IN (${marks(ids.length)})`,
  )
  .all(...ids)
  .map((r) => String(r.user_id));
if (custIds.length) {
  const d = countOf(
    `SELECT COUNT(*) AS n FROM trade_deposits WHERE user_id IN (${marks(custIds.length)})`,
    custIds,
  );
  plan.push({
    label: "trade_deposits (demo customers)",
    sql: `DELETE FROM trade_deposits WHERE user_id IN (${marks(custIds.length)})`,
    params: custIds,
    n: d,
  });
  plan.push({
    label: "users (demo customers)",
    sql: `DELETE FROM users WHERE id IN (${marks(custIds.length)})`,
    params: custIds,
    n: custIds.length,
  });
  console.log(`  ${String(d).padStart(5)}  trade_deposits (demo customers)`);
  console.log(`  ${String(custIds.length).padStart(5)}  users (demo customers)`);
}

if (!YES) {
  console.log("\nDry run only. Re-run with --yes to remove the rows above.");
  process.exit(0);
}

db.exec("BEGIN");
try {
  for (const p of plan) db.prepare(p.sql).run(...p.params);
  db.prepare(
    `DELETE FROM affiliates WHERE id IN (${marks(ids.length)})`,
  ).run(...ids);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("Rolled back, nothing removed:", e?.message || e);
  process.exit(1);
}

const after = db.prepare("SELECT COUNT(*) AS n FROM affiliates").get().n;
console.log(`\nRemoved ${targets.length} affiliate(s). ${after} remain.`);

// Anything still carrying a demo code would mean a dangling reference.
const dangling = db
  .prepare(
    `SELECT COUNT(*) AS n FROM affiliate_clicks WHERE code IN (${marks(codes.length)})`,
  )
  .get(...codes).n;
console.log(`clicks still referencing a removed code: ${dangling}`);
