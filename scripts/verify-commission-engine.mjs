// scripts/verify-commission-engine.mjs — the commission engine, fault-tested.
//
//   node scripts/verify-commission-engine.mjs [baseURL]
//
// verify-attribution.mjs proves one deposit pays a partner once. This goes
// further: it proves the RULES hold over time, and that the ledger can be
// repaired when something has gone wrong.
//
// The important half is from section 4 on. The live path is the easy case. What
// actually costs money is a ledger that is *silently incomplete* — so this script
// deliberately corrupts the database (deletes a commission row, zeroes a cached
// counter, plants a commission pointing at no deposit) and then checks that
// reconciliation finds every one of them and restores exactly the right amount,
// at the rate that was in force at the time.
//
// Fault injection needs direct database access. That is deliberate: an HTTP API
// able to delete commission rows is one nobody should build. The REPAIR goes
// through the real admin endpoint, so what is exercised is what an operator runs.
//
// Exits 0 on success, 1 on a failed check, 2 if it cannot sign in at all.

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const DB_PATH = process.env.DB_PATH || "data/trade.db";

const PARTNER_EMAIL = process.env.PARTNER_EMAIL || "demo@tradestox.pro";
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD || "Partner@Demo1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Demo@123456";

const PROBE_IP = "203.0.113.79";
const STAMP = Date.now();
const TAG = `engine-${STAMP.toString(36)}`;
const TRADER_PW = "Engine@1234";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, info = "") {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}${info ? `  (${info})` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${info ? `  (${info})` : ""}`);
  }
}

const section = (t) => console.log(`\n${t}`);
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cookieOf = (r) => (r.headers.getSetCookie?.() || []).join("; ");
const pick = (c, n) => (c.match(new RegExp(`${n}=([^;]+)`)) || [])[1] || "";
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

const db = new DatabaseSync(DB_PATH);

async function login(path, email, password) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return {
    status: r.status,
    cookie: cookieOf(r),
    json: await r.json().catch(() => null),
  };
}

let seq = 0;
const nextPhone = () => {
  seq += 1;
  return "9" + String(STAMP).slice(-6) + String(seq).padStart(3, "0");
};

/**
 * A brand new customer owned by `code`, created the way a real one is: a click
 * that drops the referral cookie, then a signup carrying it. Returns the broker
 * client code, which is how the partner's own panel identifies them.
 */
async function newCustomer(code, ua) {
  const click = await fetch(BASE + "/api/track/click", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": ua,
      "x-forwarded-for": PROBE_IP,
    },
    body: JSON.stringify({ code, slug: "start", campaign: TAG }),
  });
  seq += 1;
  const uname = `engine_${STAMP}_${seq}`;
  const reg = await fetch(BASE + "/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieOf(click) },
    body: JSON.stringify({
      username: uname,
      email: `${uname}@engine.local`,
      password: TRADER_PW,
      phone: nextPhone(),
    }),
  });
  if (reg.status !== 200) return null;

  const log = await fetch(BASE + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: uname, password: TRADER_PW }),
  });
  const token = (await log.json().catch(() => null))?.token || "";
  if (!token) return null;

  const det = await fetch(BASE + "/api/v1/auth/getAccountDetails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: "{}",
  });
  const clientID = String((await det.json().catch(() => null))?.clientID || "");
  const accountId = clientID.replace(/^u-/, "");
  // The partner panel identifies a customer by their BROKER CLIENT CODE
  // (TK26…), not by the internal `u-…` id, so the two are not interchangeable
  // when matching commission rows back to a person.
  const clientCode = String(
    db
      .prepare(
        "SELECT COALESCE(NULLIF(client_code,''), id) AS code FROM users WHERE id = ?",
      )
      .get(accountId)?.code || "",
  );
  return { clientID, accountId, clientCode, username: uname };
}

async function main() {
  console.log(`Verifying the commission engine against ${BASE}`);

  const partnerLogin = await login(
    "/api/partners/login",
    PARTNER_EMAIL,
    sha256Hex(PARTNER_PASSWORD),
  );
  const partner = pick(partnerLogin.cookie, "partner_token");
  const adminLogin = await login(
    "/api/admin/login",
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
  );
  const admin = pick(adminLogin.cookie, "admin_token");

  if (!partner || !admin) {
    console.log(
      `\nCannot continue: partner=${partnerLogin.status} admin=${adminLogin.status}`,
    );
    return 2;
  }

  const ph = { cookie: `partner_token=${partner}` };
  const ah = { cookie: `admin_token=${admin}` };

  const me = await (
    await fetch(BASE + "/api/partners/me", { headers: ph })
  ).json();
  const aff = me?.affiliate || {};
  const code = aff.code || "";
  const ORIGINAL = {
    id: aff.id,
    model: aff.model,
    depositRate: aff.depositRate,
    revRate: aff.revRate,
  };
  check(
    "partner session resolves",
    !!code && !!aff.id,
    `${code} · ${aff.model}`,
  );

  const earnings = async () =>
    (await fetch(BASE + "/api/partners/earnings", { headers: ph })).json();
  const codesFor = async (clientID) =>
    ((await earnings())?.commissions || []).filter(
      (c) => c.customer === clientID,
    );

  const credit = async (accountId, amount, note) =>
    (
      await fetch(BASE + "/api/admin/clients", {
        method: "POST",
        headers: { ...ah, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: accountId,
          deposit: amount,
          depositNote: note,
        }),
      })
    ).status;

  const reconcile = async (apply) => {
    const r = await fetch(BASE + "/api/admin/affiliate-reconcile", {
      method: "POST",
      headers: { ...ah, "Content-Type": "application/json" },
      body: JSON.stringify({ affiliateId: ORIGINAL.id, apply, limit: 500 }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  // ── 1 ─────────────────────────────────────────────────────────────────────
  section("1. The first deposit earns the first-deposit rate");

  const customerA = await newCustomer(code, `engine-a-${STAMP}`);
  check(
    "a customer can be attributed",
    !!customerA?.clientCode,
    customerA?.clientCode || "failed",
  );

  check(
    "deposit 1 is accepted",
    (await credit(customerA.accountId, 40000, TAG)) === 200,
  );
  const afterFirst = await codesFor(customerA.clientCode);
  const firstRow = afterFirst.find((c) => c.kind === "Deposit %");
  const expectedFirst = money(40000 * (ORIGINAL.depositRate / 100));
  const wantsFirst =
    ORIGINAL.model === "deposit" || ORIGINAL.model === "hybrid";
  const wantsRecur =
    ORIGINAL.model === "revshare" || ORIGINAL.model === "hybrid";

  if (wantsFirst)
    check(
      "the first-deposit commission matches the stated rate",
      !!firstRow && close(firstRow.amount, expectedFirst),
      `rate=${firstRow?.rate}% amount=₹${firstRow?.amount} expected=₹${expectedFirst}`,
    );
  else check("a revshare-only partner earns no first-deposit bonus", !firstRow);

  // ── 2 ─────────────────────────────────────────────────────────────────────
  section("2. A second deposit is recurring, never a second bonus");

  check(
    "deposit 2 is accepted",
    (await credit(customerA.accountId, 20000, TAG)) === 200,
  );
  const afterSecond = await codesFor(customerA.clientCode);
  const firstCount = afterSecond.filter((c) => c.kind === "Deposit %").length;
  if (wantsFirst)
    check(
      "the first-deposit rate is NOT paid a second time",
      firstCount === 1,
      `${firstCount} first-deposit row(s) after two deposits`,
    );

  const recurRows = afterSecond.filter((c) => c.kind === "Recurring share");
  check(
    `recurring rows for a ${ORIGINAL.model} model`,
    wantsRecur ? recurRows.length === 2 : recurRows.length === 0,
    `${recurRows.length} row(s), expected ${wantsRecur ? 2 : 0}`,
  );

  // ── 3 ─────────────────────────────────────────────────────────────────────
  section("3. A SETTLED ledger reconciles clean");

  const report = await reconcile(false);
  check(
    "an operator can read a reconciliation report",
    report.status === 200,
    `status=${report.status}`,
  );

  // Settle first, THEN assert clean.
  //
  // An interrupted earlier run can leave a genuinely missing row behind, and
  // reporting that is the tool working correctly, not a failure. The claim worth
  // testing is that repairing brings the ledger to a provably clean state —
  // which is also exactly how an operator is meant to use this.
  await reconcile(true);
  const beforeCount = ((await earnings())?.commissions || []).length;
  const clean = await reconcile(false);
  check(
    "after settling, no commission is missing",
    (clean.json?.missing || 0) === 0,
    `missing=${clean.json?.missing} ₹${clean.json?.missingAmount}`,
  );
  check(
    "after settling, no counter has drifted",
    (clean.json?.drifted || 0) === 0,
    `drifted=${clean.json?.drifted}`,
  );
  check(
    "after settling, no amount disagrees with the ledger",
    (clean.json?.mismatched || 0) === 0,
    `mismatched=${clean.json?.mismatched}`,
  );
  check(
    "a dry run changes nothing",
    ((await earnings())?.commissions || []).length === beforeCount,
    `${beforeCount} rows before and after`,
  );

  // ── 4 ─────────────────────────────────────────────────────────────────────
  section("4. A SILENTLY MISSING commission is found and repaired");

  const victim = db
    .prepare(
      `SELECT id, idem, amount FROM affiliate_commissions
        WHERE user_id = ? AND idem LIKE 'dep:%' ORDER BY id ASC LIMIT 1`,
    )
    .get(customerA.accountId);
  check(
    "there is a commission row to remove",
    !!victim,
    victim?.idem || "none",
  );

  db.prepare("DELETE FROM affiliate_commissions WHERE id = ?").run(victim.id);
  // Corrupt the cached figure at the same time, the way a lost write would.
  db.prepare(
    "UPDATE affiliate_referrals SET deposited = 0 WHERE user_id = ?",
  ).run(customerA.accountId);

  const dry = await reconcile(false);
  check(
    "reconciliation FINDS the missing commission",
    (dry.json?.missing || 0) >= 1,
    `missing=${dry.json?.missing} ₹${dry.json?.missingAmount}`,
  );
  check(
    "reconciliation finds the corrupted counter",
    (dry.json?.drifted || 0) >= 1,
    `drifted=${dry.json?.drifted}`,
  );
  check(
    "a dry run does not repair anything",
    db
      .prepare("SELECT COUNT(*) AS n FROM affiliate_commissions WHERE id = ?")
      .get(victim.id).n === 0,
  );

  const applied = await reconcile(true);
  check(
    "applying the repair writes the row back",
    (applied.json?.repaired || 0) >= 1,
    `repaired=${applied.json?.repaired} ₹${applied.json?.repairedAmount}`,
  );
  const restored = db
    .prepare(
      "SELECT amount, rate, reconciled, deposit_id, earned_at FROM affiliate_commissions WHERE idem = ?",
    )
    .get(victim.idem);
  check(
    "the repaired row restores the exact original amount",
    !!restored && close(restored.amount, victim.amount),
    `was ₹${victim.amount}, now ₹${restored?.amount}`,
  );
  check(
    "the repaired row is marked as reconciled, not passed off as live",
    Number(restored?.reconciled) === 1,
  );
  check(
    "it still points at the deposit that caused it",
    Number(restored?.deposit_id) > 0,
    `deposit_id=${restored?.deposit_id}`,
  );
  const fixed = db
    .prepare("SELECT deposited FROM affiliate_referrals WHERE user_id = ?")
    .get(customerA.accountId);
  check(
    "the cached deposit figure is rebuilt from the ledger",
    close(fixed.deposited, 60000),
    `deposited=₹${fixed.deposited}, ledger says ₹60000`,
  );

  // ── 5 ─────────────────────────────────────────────────────────────────────
  section("5. Repair uses the rate in force THEN, not today's");

  const NEW_REV = ORIGINAL.revRate === 44 ? 45 : 44;
  const setRate = async (revRate) =>
    (
      await fetch(BASE + "/api/admin/affiliates", {
        method: "POST",
        headers: { ...ah, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", id: ORIGINAL.id, revRate }),
      })
    ).status;
  check(
    "an operator can change the rev-share rate",
    (await setRate(NEW_REV)) === 200,
  );

  const termsRows = db
    .prepare(
      `SELECT rev_rate FROM affiliate_terms_history
        WHERE affiliate_id = ? ORDER BY at ASC, id ASC`,
    )
    .all(ORIGINAL.id);
  check(
    "the change is appended to the terms history",
    termsRows.length >= 2,
    `${termsRows.length} revision(s), latest ${termsRows.at(-1)?.rev_rate}%`,
  );

  const oldRecur = db
    .prepare(
      `SELECT id, idem, amount, rate FROM affiliate_commissions
        WHERE user_id = ? AND source = 'recur' ORDER BY id ASC LIMIT 1`,
    )
    .get(customerA.accountId);
  if (!oldRecur) {
    console.log("  skip  no recurring row to test the historical rate with");
  } else {
    db.prepare("DELETE FROM affiliate_commissions WHERE id = ?").run(
      oldRecur.id,
    );
    const rep = await reconcile(true);
    const back = db
      .prepare("SELECT amount, rate FROM affiliate_commissions WHERE idem = ?")
      .get(oldRecur.idem);
    check(
      "the repaired row uses the rate that was in force at deposit time",
      !!back && close(back.rate, oldRecur.rate),
      `earned at ${oldRecur.rate}%, repaired at ${back?.rate}%, current rate is ${NEW_REV}%`,
    );
    check(
      "and therefore restores the original amount, not today's",
      !!back && close(back.amount, oldRecur.amount),
      `was ₹${oldRecur.amount}, now ₹${back?.amount}`,
    );
    check(
      "the repair run reports what it did",
      (rep.json?.repaired || 0) >= 1,
      `repaired=${rep.json?.repaired}`,
    );
  }

  // ── 6 ─────────────────────────────────────────────────────────────────────
  section("6. An orphaned commission is reported, never silently deleted");

  const plantedIdem = `dep:999999999:first`;
  db.prepare(
    `INSERT INTO affiliate_commissions
       (affiliate_id, user_id, source, idem, base_amount, rate, amount, status,
        created_at, note, deposit_id, earned_at)
     VALUES (?,?,?,?,?,?,?, 'pending', ?, 'Orphan probe', 999999999, ?)`,
  ).run(
    ORIGINAL.id,
    customerA.accountId,
    "orphan",
    plantedIdem,
    1,
    1,
    1,
    Date.now(),
    Date.now(),
  );

  const orphanRun = await reconcile(false);
  check(
    "reconciliation reports the orphan",
    (orphanRun.json?.orphaned || 0) >= 1,
    `orphaned=${orphanRun.json?.orphaned}`,
  );
  check(
    "it is left in place — deleting money rows is a human decision",
    db
      .prepare("SELECT COUNT(*) AS n FROM affiliate_commissions WHERE idem = ?")
      .get(plantedIdem).n === 1,
  );
  db.prepare("DELETE FROM affiliate_commissions WHERE idem = ?").run(
    plantedIdem,
  );

  // ── 7 ─────────────────────────────────────────────────────────────────────
  section("7. Running reconciliation twice cannot pay twice");

  const settle1 = await reconcile(true);
  const n1 = db
    .prepare(
      "SELECT COUNT(*) AS n FROM affiliate_commissions WHERE user_id = ?",
    )
    .get(customerA.accountId).n;
  const settle2 = await reconcile(true);
  const n2 = db
    .prepare(
      "SELECT COUNT(*) AS n FROM affiliate_commissions WHERE user_id = ?",
    )
    .get(customerA.accountId).n;
  check(
    "the first settling run finds nothing left to repair",
    (settle1.json?.repaired || 0) === 0,
    `repaired=${settle1.json?.repaired} missing=${settle1.json?.missing}`,
  );
  check("a second run adds no rows", n1 === n2, `${n1} -> ${n2}`);
  check(
    "the ledger is clean at the end",
    (settle2.json?.missing || 0) === 0 &&
      (settle2.json?.mismatched || 0) === 0 &&
      (settle2.json?.drifted || 0) === 0 &&
      (settle2.json?.orphaned || 0) === 0,
    `missing=${settle2.json?.missing} mismatched=${settle2.json?.mismatched} drifted=${settle2.json?.drifted} orphaned=${settle2.json?.orphaned}`,
  );

  // ── 8 ─────────────────────────────────────────────────────────────────────
  section("8. The commission model set is CLOSED — there is no CPA");

  const setModel = async (model) => {
    const r = await fetch(BASE + "/api/admin/affiliates", {
      method: "POST",
      headers: { ...ah, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decide", id: ORIGINAL.id, model }),
    });
    return r.status;
  };
  for (const bogus of ["cpa", "CPA", "per-lead", "revenue", ""]) {
    const st = await setModel(bogus);
    // An empty string clears the override back to the plan, which is legitimate.
    const expected = bogus === "" ? 200 : 400;
    check(
      `model "${bogus || "(empty)"}" is ${expected === 400 ? "refused" : "treated as a reset"}`,
      st === expected,
      `status=${st}`,
    );
  }
  for (const ok of ["deposit", "revshare", "hybrid"]) {
    check(`model "${ok}" is accepted`, (await setModel(ok)) === 200);
  }

  // ── 9 ─────────────────────────────────────────────────────────────────────
  section("9. Leave the affiliate's terms as they were found");

  check(
    "original model restored",
    (await setModel(ORIGINAL.model)) === 200,
    ORIGINAL.model,
  );
  check(
    "original rate restored",
    (await setRate(ORIGINAL.revRate)) === 200,
    `revRate back to ${ORIGINAL.revRate}%`,
  );

  return fail ? 1 : 0;
}

const rc = await main();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(
    `\nFailed checks:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
  );
} else if (rc === 0) {
  console.log("Commission engine verified.");
}

process.exitCode = rc;
