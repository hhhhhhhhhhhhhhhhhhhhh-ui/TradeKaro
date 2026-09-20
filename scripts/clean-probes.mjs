// scripts/clean-probes.mjs — remove the rows the verification suites create.
//
//   node scripts/clean-probes.mjs          → dry run, prints what it would delete
//   node scripts/clean-probes.mjs --yes    → actually deletes
//
// verify-links.mjs and verify-attribution.mjs have to write real rows to prove
// anything: a click that is not recorded cannot be counted, and a signup that
// does not happen cannot be attributed. Those runs therefore leave probe data in
// whatever database they were pointed at.
//
// Because this DELETES rows, it is a dry run unless you pass --yes, and it only
// touches rows that the probe scripts tag unambiguously:
//
//   • clicks from the reserved TEST-NET-3 addresses 203.0.113.77 / .78, which
//     can never be real traffic
//
// NOTE: match those two addresses EXACTLY, never the whole 203.0.113.x range.
// The demo seed puts its fake clicks on 203.0.113.0, which sits in the same
// range — a wildcard delete would take out 256 rows of legitimate demo history
// along with the probes.
//   • accounts on the @attrib.local domain and the attrib_ username prefix
//   • commission and deposit rows belonging to those accounts
//
// Nothing else is matched, and it prints every count before and after.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const YES = process.argv.includes("--yes");

// Relative to the repo root, which is where npm scripts run from.
const DB_PATH = process.env.DB_PATH || "data/trade.db";
if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run this from the repo root.`);
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH);
const PROBE_IPS = ["203.0.113.77", "203.0.113.78", "203.0.113.79"];

const ids = db
  .prepare(
    `SELECT id FROM users
      WHERE email LIKE '%@attrib.local' OR email LIKE '%@engine.local'`,
  )
  .all()
  .map((r) => String(r.id));

const prefixed = ids.map((id) => `u-${id}`);
const marks = (n) => Array.from({ length: n }, () => "?").join(",");

const plan = [];
function plan_delete(label, sql, params = []) {
  const n =
    db.prepare(sql.replace(/^DELETE/, "SELECT COUNT(*) AS n")).get(...params)
      ?.n ?? 0;
  plan.push({ label, n, sql, params });
}

if (ids.length) {
  plan_delete(
    "affiliate_commissions (probe customers)",
    `DELETE FROM affiliate_commissions WHERE user_id IN (${marks(ids.length)})`,
    ids,
  );
  plan_delete(
    "affiliate_referrals (probe customers)",
    `DELETE FROM affiliate_referrals WHERE user_id IN (${marks(ids.length)})`,
    ids,
  );
  plan_delete(
    "trade_deposits (probe customers)",
    `DELETE FROM trade_deposits WHERE user_id IN (${marks(prefixed.length)})`,
    prefixed,
  );
  plan_delete(
    "watchlist (probe customers)",
    `DELETE FROM watchlist WHERE user_id IN (${marks(prefixed.length)})`,
    prefixed,
  );
  plan_delete(
    "users (probe accounts)",
    `DELETE FROM users WHERE id IN (${marks(ids.length)})`,
    ids,
  );
}

plan_delete(
  "affiliate_clicks (probe clicks)",
  `DELETE FROM affiliate_clicks WHERE ip IN (${marks(PROBE_IPS.length)})`,
  PROBE_IPS,
);

plan_delete(
  "affiliate_requests (probe requests)",
  `DELETE FROM affiliate_requests WHERE title IN ('verify-links probe', 'verify-attribution probe')`,
);

console.log(`${DB_PATH}${YES ? "" : "  [DRY RUN — pass --yes to apply]"}\n`);
let total = 0;
for (const p of plan) {
  total += p.n;
  console.log(`  ${String(p.n).padStart(4)}  ${p.label}`);
}
console.log(`\n  ${ids.length} probe account id(s) identified`);

if (!total) {
  console.log("\nNothing to clean.");
  process.exit(0);
}
if (!YES) {
  console.log("\nDry run only. Re-run with --yes to delete the rows above.");
  process.exit(0);
}

db.exec("BEGIN");
try {
  for (const p of plan) db.prepare(p.sql).run(...p.params);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("Rolled back, nothing deleted:", e?.message || e);
  process.exit(1);
}

const left = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE email LIKE '%@attrib.local') AS users,
       (SELECT COUNT(*) FROM affiliate_clicks
         WHERE ip IN (${marks(PROBE_IPS.length)})) AS clicks,
       (SELECT COUNT(*) FROM affiliate_referrals WHERE campaign LIKE 'attrib-%') AS refs`,
  )
  .get(...PROBE_IPS);

console.log(
  `\nRemoved ${total} row(s). Remaining probe rows: ` +
    `${left.users} account(s), ${left.clicks} click(s), ${left.refs} referral(s).`,
);
