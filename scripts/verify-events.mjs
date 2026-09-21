// scripts/verify-events.mjs — Phase 3: the conversion event map.
//
//   node scripts/verify-events.mjs [baseURL]
//
// What is actually at risk here:
//
//   1. The event NAME. A wrong name does not error — Meta silently drops a
//      standard event it does not recognise, and Google files it as a custom
//      event no campaign can bid against. Both look like "no conversions".
//
//   2. The event ID. Meta and Google collapse the browser copy and the server
//      copy of one conversion ONLY if the two share an id. If they diverge the
//      customer is counted twice in every report, permanently, and the ad
//      platform optimises toward a number that is inflated.
//
//   3. Idempotency. `Purchase` is written from a payment webhook. If a retry
//      creates a second event the platform is told about a purchase that
//      happened once — and the affiliate path is keyed the same way, so the
//      habit of deriving ids from the domain entity is load-bearing for money,
//      not just for reports.
//
// A real signup is created and removed each run, so this must be able to write
// to the database the server is using.
//
// Exits 0 on pass, 1 on a failed check, 2 when the server is unreachable.

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

const CODE = process.env.PARTNER_CODE || "PT-DEMO01";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Demo@123456";

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

function section(title) {
  console.log(`\n${title}`);
}

const sha256Hex = (s) =>
  import("node:crypto").then((m) =>
    m.createHash("sha256").update(s).digest("hex"),
  );

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(++n).toString(36)}`;

// Phones are UNIQUE in the users table, so a fixed test number makes the second
// run of this script fail with a 409 that looks like a broken signup. Seed the
// block from the clock and step through it per user.
const phoneBase = 10_000_000 + (Date.now() % 90_000_000);
let phoneN = 0;
const nextPhone = () =>
  `99${String((phoneBase + ++phoneN) % 100_000_000).padStart(8, "0")}`;

async function register(body, cookie = "") {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

async function main() {
  console.log(`Event verification against ${BASE}\n`);

  const db = await import("node:sqlite").then((m) => {
    const { DatabaseSync } = m;
    // Read-write: this check creates real signups, and leaving them behind would
    // pollute the operator's customer list and every subsequent report.
    return new DatabaseSync("data/trade.db");
  });

  // ── the map itself ─────────────────────────────────────────────────────
  section("Event names match what the platforms expect");

  // Read the map from the source of truth rather than restating it here — a
  // copy of the table in the test only proves the test agrees with itself.
  const src = await import("node:fs").then((m) =>
    m.readFileSync("app/lib/trackingEvents.ts", "utf8"),
  );

  const EXPECTED = [
    ["PageView", "PageView", "page_view"],
    ["Lead", "Lead", "begin_checkout"],
    ["CompleteRegistration", "CompleteRegistration", "sign_up"],
    ["Purchase", "Purchase", "purchase"],
  ];
  for (const [canonical, meta, ga4] of EXPECTED) {
    const row = new RegExp(
      `${canonical}:\\s*\\{\\s*meta:\\s*"${meta}"\\s*,\\s*ga4:\\s*"${ga4}"\\s*\\}`,
    );
    check(`${canonical} → Meta ${meta} / GA4 ${ga4}`, row.test(src));
  }

  // ── ids must be derived, not random ────────────────────────────────────
  section("Dedup ids are derived from the domain entity");

  check(
    "signup id is derived from the user id",
    /signup:\$\{String\(userId\)\.trim\(\)\}/.test(src),
  );
  check(
    "deposit id is derived from the deposit row id",
    /deposit:\$\{String\(depositRowId\)\.trim\(\)\}/.test(src),
  );
  check(
    "a random id exists only for events with no server counterpart",
    /export function newEventId/.test(src),
  );

  // ── a real signup writes a real event ──────────────────────────────────
  section("A signup records CompleteRegistration");

  const tag = uniq();
  const email = `evt-${tag}@events.local`;
  const user = `evt${tag}`.slice(0, 24);
  const pw = await sha256Hex("Engine@12345");

  const before = db
    .prepare(
      `SELECT COUNT(*) n FROM conversion_events WHERE name='CompleteRegistration'`,
    )
    .get().n;

  const reg = await register({
    username: user,
    email,
    password: pw,
    phone: nextPhone(),
  });
  check(
    "signup succeeded",
    reg.ok === true,
    `status=${reg.status}${reg.error ? ` ${reg.error}` : ""}`,
  );
  check(
    "the API returns an event id for the browser pixel to share",
    typeof reg.eventId === "string" && reg.eventId.startsWith("signup:"),
    reg.eventId,
  );

  const row = reg.eventId
    ? db
        .prepare(
          `SELECT event_id, name, user_id, consent, value, currency, dispatched_at
             FROM conversion_events WHERE event_id = ?`,
        )
        .get(reg.eventId)
    : undefined;
  check("the event was written", !!row, row?.name);
  check("with the canonical name", row?.name === "CompleteRegistration");
  check("carrying no money", row?.value == null, `value=${row?.value}`);
  check(
    "and it is still owed to the platforms",
    row?.dispatched_at == null,
    `dispatched_at=${row?.dispatched_at}`,
  );
  check(
    "consent was resolved rather than left blank",
    ["granted", "denied", "exempt", "unknown"].includes(String(row?.consent)),
    `consent=${row?.consent}`,
  );

  const after = db
    .prepare(
      `SELECT COUNT(*) n FROM conversion_events WHERE name='CompleteRegistration'`,
    )
    .get().n;
  check(
    "exactly one row was added",
    after === before + 1,
    `${before} → ${after}`,
  );

  // ── a replayed signup must not double-report ───────────────────────────
  section("Replays do not double-count");

  const dupe = await register({
    username: user,
    email,
    password: pw,
    phone: nextPhone(),
  });
  check(
    "re-registering the same details is refused",
    dupe.status === 409,
    `status=${dupe.status}`,
  );
  const afterDupe = db
    .prepare(
      `SELECT COUNT(*) n FROM conversion_events WHERE name='CompleteRegistration'`,
    )
    .get().n;
  check("and adds no second event", afterDupe === after);

  // A second user gets a distinct id — derived does not mean shared.
  const reg2 = await register({
    username: `${user}b`,
    email: `evt-${tag}-b@events.local`,
    password: pw,
    phone: nextPhone(),
  });
  check(
    "a different user gets a different id",
    reg2.eventId && reg2.eventId !== reg.eventId,
    reg2.eventId,
  );

  // ── consent is inherited, not invented ─────────────────────────────────
  section("Consent travels with the event");

  const regDe = await register(
    {
      username: `${user}c`,
      email: `evt-${tag}-c@events.local`,
      password: pw,
      phone: nextPhone(),
    },
    "tc_consent=granted",
  );
  const rowDe = regDe.eventId
    ? db
        .prepare(`SELECT consent FROM conversion_events WHERE event_id = ?`)
        .get(regDe.eventId)
    : undefined;
  check(
    "an explicit answer is recorded on the event",
    rowDe?.consent === "granted",
    `consent=${rowDe?.consent}`,
  );

  // The gap that would have gone unnoticed: a visitor from a country that owes
  // no banner never gets a `tc_consent` cookie and may have no affiliate click
  // either. If that resolves to `unknown`, Phase 4 declines to report them and
  // every organic Indian signup is silently discarded.
  const regIn = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-ipcountry": "IN",
      "user-agent": "verify-events/exempt",
    },
    body: JSON.stringify({
      username: `${user}d`,
      email: `evt-${tag}-d@events.local`,
      password: pw,
      phone: nextPhone(),
    }),
  }).then((r) => r.json().catch(() => ({})));
  const rowIn = regIn.eventId
    ? db
        .prepare(`SELECT consent FROM conversion_events WHERE event_id = ?`)
        .get(regIn.eventId)
    : undefined;
  check(
    "a signup from an exempt country is permitted, not left unknown",
    rowIn?.consent === "exempt",
    `consent=${rowIn?.consent}`,
  );

  const regDeNoshow = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-ipcountry": "DE",
      "user-agent": "verify-events/asked",
    },
    body: JSON.stringify({
      username: `${user}e`,
      email: `evt-${tag}-e@events.local`,
      password: pw,
      phone: nextPhone(),
    }),
  }).then((r) => r.json().catch(() => ({})));
  const rowDeNo = regDeNoshow.eventId
    ? db
        .prepare(`SELECT consent FROM conversion_events WHERE event_id = ?`)
        .get(regDeNoshow.eventId)
    : undefined;
  check(
    "a signup from a country owed a banner is NOT presumed permitted",
    rowDeNo?.consent === "unknown",
    `consent=${rowDeNo?.consent}`,
  );

  // ── the event that pays ────────────────────────────────────────────────
  section("A credited deposit records Purchase");

  const adminLogin = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const adminCookie = (adminLogin.headers.getSetCookie?.() || []).join("; ");
  const adminToken = (adminCookie.match(/admin_token=([^;]+)/) || [])[1] || "";

  if (!adminToken) {
    check("admin sign-in worked", false, `status=${adminLogin.status}`);
  } else {
    check("admin sign-in worked", true);

    // A fresh customer so the deposit cannot disturb a real balance.
    const buyer = `${user}x`;
    const regBuy = await register({
      username: buyer,
      email: `evt-${tag}-x@events.local`,
      password: pw,
      phone: nextPhone(),
    });
    const buyerId = String(regBuy.eventId || "").replace("signup:", "");
    check("a customer was created to fund", !!buyerId, buyerId);

    const credit = async (amount) => {
      const res = await fetch(`${BASE}/api/admin/clients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `admin_token=${adminToken}`,
        },
        body: JSON.stringify({
          id: buyerId,
          deposit: amount,
          depositNote: `evt-${tag}`,
        }),
      });
      return res.status;
    };

    const s1 = await credit(5000);
    check("the deposit was accepted", s1 === 200, `status=${s1}`);

    const purchase = db
      .prepare(
        `SELECT event_id, name, user_id, value, currency, consent, dispatched_at
           FROM conversion_events
          WHERE user_id = ? AND name = 'Purchase'`,
      )
      .all(buyerId);
    check(
      "a Purchase event was written",
      purchase.length === 1,
      `${purchase.length} row(s)`,
    );
    check(
      "its id is derived from the deposit row",
      /^deposit:\d+$/.test(String(purchase[0]?.event_id)),
      purchase[0]?.event_id,
    );
    check(
      "it carries the money",
      Number(purchase[0]?.value) === 5000,
      `value=${purchase[0]?.value}`,
    );
    check(
      "in the right currency",
      purchase[0]?.currency === "INR",
      purchase[0]?.currency,
    );
    check(
      "and it is still owed to the platforms",
      purchase[0]?.dispatched_at == null,
    );

    // The row id in the event id must be the real deposit, or the id is
    // decorative and the dedup guarantee it carries is fiction.
    const depositRowId = Number(String(purchase[0]?.event_id).split(":")[1]);
    const ledger = db
      .prepare("SELECT id, amount, user_id FROM trade_deposits WHERE id = ?")
      .get(depositRowId);
    check(
      "and that id points at the deposit that actually happened",
      !!ledger && Number(ledger.amount) === 5000,
      `deposit#${depositRowId} amount=${ledger?.amount}`,
    );

    // Two real deposits are two purchases, not one.
    await credit(2500);
    const twoPurchases = db
      .prepare(
        `SELECT COUNT(*) n FROM conversion_events WHERE user_id = ? AND name='Purchase'`,
      )
      .get(buyerId).n;
    check(
      "a second deposit is a second purchase",
      twoPurchases === 2,
      `${twoPurchases}`,
    );

    // The UNIQUE index is what makes a webhook retry harmless. Prove it exists
    // rather than trusting that the schema in the file was applied.
    let refused = false;
    try {
      db.prepare(
        `INSERT INTO conversion_events
           (event_id, name, user_id, occurred_at, created_at)
         VALUES (?,?,?,?,?)`,
      ).run(purchase[0].event_id, "Purchase", buyerId, Date.now(), Date.now());
    } catch {
      refused = true;
    }
    check("a duplicate event id is refused by the database", refused);
  }

  // ── cleanup ────────────────────────────────────────────────────────────
  // Every user this check made is on `@events.local`, and the events it wrote
  // are keyed to those users. Removed in dependency order.
  let removed = 0;
  // Deposits are keyed to test users; the ledger rows have to go before the
  // users they point at, or the foreign reference is left dangling.
  removed += db
    .prepare(
      `DELETE FROM trade_deposits WHERE note = ? OR user_id IN (
         SELECT id FROM users WHERE email LIKE '%@events.local')`,
    )
    .run(`evt-${tag}`).changes;
  removed += db
    .prepare(
      // Match both id forms. The code normalises to the bare id, but a cleanup
      // that only matches the form it expects leaks rows the moment that
      // normalisation regresses — and it would leak them quietly, into a table
      // nobody reads.
      `DELETE FROM conversion_events
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@events.local')
           OR user_id IN (SELECT 'u-' || id FROM users WHERE email LIKE '%@events.local')
           OR user_id IN (SELECT REPLACE(id,'u-','') FROM users WHERE email LIKE '%@events.local')`,
    )
    .run().changes;
  removed += db
    .prepare("DELETE FROM users WHERE email LIKE '%@events.local'")
    .run().changes;
  console.log(`\ncleanup: removed ${removed} row(s) created by this check`);

  // ── report ─────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("Conversion events are mapped and deduplicated correctly.");
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  console.error("Is the server running?");
  process.exitCode = 2;
});
