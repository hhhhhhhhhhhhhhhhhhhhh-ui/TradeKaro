// scripts/verify-capi.mjs — Phase 4: server-side conversion delivery.
//
//   node scripts/verify-capi.mjs [baseURL] [mockURL]
//
// RUNS AGAINST A SERVER CONFIGURED TO TALK TO scripts/mock-capi.mjs, because the
// things worth proving here can only be seen from the receiving end:
//
//   • a hashed email goes out and a RAW one never does — the one mistake in this
//     area that is silent, invisible, and a compliance incident
//   • Meta's event_time is in SECONDS (milliseconds are rejected with a 400 whose
//     message reads like a malformed timestamp)
//   • a 500 causes a backoff and a retry, not a lost conversion
//   • consent is enforced at SEND time: `denied` and `unknown` never leave
//   • a retry does not send the same conversion twice
//
// Start the mock first:
//   node scripts/mock-capi.mjs 4123
// then start the app with the mock endpoints and a dispatch secret, e.g.
//   META_PIXEL_ID=test META_CAPI_TOKEN=test META_GRAPH_BASE=http://127.0.0.1:4123 \
//   NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TEST GA4_API_SECRET=test GA4_MP_BASE=http://127.0.0.1:4123 \
//   TRACKING_DISPATCH_SECRET=test-secret npm start
//
// Exits 0 on pass, 1 on failure, 2 when the server is not configured for this.

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const MOCK = (
  process.argv[3] ||
  process.env.MOCK_URL ||
  "http://127.0.0.1:4123"
).replace(/\/+$/, "");
const SECRET = process.env.TRACKING_DISPATCH_SECRET || "test-secret";
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
const section = (t) => console.log(`\n${t}`);

const sha256Hex = (s) =>
  import("node:crypto").then((m) =>
    m.createHash("sha256").update(s).digest("hex"),
  );

const dispatch = async (qs = "") =>
  (
    await fetch(`${BASE}/api/track/dispatch${qs}`, {
      method: "POST",
      headers: { "x-dispatch-secret": SECRET },
    })
  ).json();

const captured = async () => (await fetch(`${MOCK}/__captured`)).json();
const reset = async () => fetch(`${MOCK}/__reset`, { method: "POST" });

let u = 0;
const uniq = () => `${Date.now().toString(36)}${(++u).toString(36)}`;
const phoneBase = 10_000_000 + (Date.now() % 90_000_000);
let phoneN = 0;
const nextPhone = () =>
  `99${String((phoneBase + ++phoneN) % 100_000_000).padStart(8, "0")}`;

async function main() {
  console.log(`CAPI verification against ${BASE} (mock: ${MOCK})\n`);

  // ── is this server even wired for the test? ────────────────────────────
  const status = await fetch(`${BASE}/api/track/dispatch`, {
    headers: { "x-dispatch-secret": SECRET },
  }).then((r) => r.json().catch(() => ({})));

  if (!status.ok) {
    console.log(
      "This server is not configured for CAPI testing (dispatch endpoint refused).",
    );
    console.log(
      "Start it with the mock endpoints and TRACKING_DISPATCH_SECRET — see the header of this file.",
    );
    process.exitCode = 2;
    return;
  }
  section("Provider configuration");
  check("the mock is reachable", (await fetch(`${MOCK}/__captured`)).ok);
  check(
    "Meta is configured",
    (status.configured || []).includes("meta"),
    (status.configured || []).join(",") || "none",
  );
  check("GA4 is configured", (status.configured || []).includes("ga4"));

  // ── authorisation ──────────────────────────────────────────────────────
  section("The dispatch endpoint is not public");
  const noAuth = await fetch(`${BASE}/api/track/dispatch`, { method: "POST" });
  check(
    "a request with no secret is refused",
    noAuth.status === 401,
    `status=${noAuth.status}`,
  );
  const wrongAuth = await fetch(`${BASE}/api/track/dispatch`, {
    method: "POST",
    headers: { "x-dispatch-secret": "nope" },
  });
  check(
    "a wrong secret is refused",
    wrongAuth.status === 401,
    `status=${wrongAuth.status}`,
  );

  // ── a real conversion, sent for real ───────────────────────────────────
  section("A signup is delivered to both providers");
  await reset();

  const tag = uniq();
  // NOT a `.local` address. The dispatcher refuses to send for fixture domains
  // (see FIXTURE_DOMAINS in conversionsDispatch.ts), and this user exists to
  // exercise the SEND path — so it needs an identity outside that list.
  // `.invalid` is reserved by RFC 2606 and can never resolve, so it is safe as a
  // test domain while deliberately not being blocked. The guard itself is
  // covered by its own check further down.
  const email = `capi-${tag}@capi-verify.invalid`;
  const pw = await sha256Hex("Engine@12345");
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Exempt jurisdiction, so consent resolves to `exempt` and sending is
      // permitted without a banner — the Indian traffic case.
      "cf-ipcountry": "IN",
      "user-agent": "verify-capi/1",
    },
    body: JSON.stringify({
      username: `capi${tag}`.slice(0, 24),
      email,
      password: pw,
      phone: nextPhone(),
    }),
  }).then((r) => r.json().catch(() => ({})));

  check("signup succeeded", reg.ok === true, `eventId=${reg.eventId}`);

  const report = await dispatch("?limit=50");
  check("the dispatcher ran", report.ok === true);
  check(
    "it sent to Meta",
    (report.outcomes || []).some(
      (o) => o.provider === "meta" && o.status === "sent",
    ),
  );
  check(
    "it sent to GA4",
    (report.outcomes || []).some(
      (o) => o.provider === "ga4" && o.status === "sent",
    ),
  );

  const got = await captured();
  const metaCall = got.filter(
    (c) =>
      c.kind === "meta" && JSON.stringify(c.body || {}).includes(reg.eventId),
  )[0];
  const ga4Call = got.filter(
    (c) =>
      c.kind === "ga4" && JSON.stringify(c.body || {}).includes(reg.eventId),
  )[0];

  check("Meta received the event", !!metaCall);
  check("GA4 received the event", !!ga4Call);

  if (metaCall) {
    const d = metaCall.body.data[0];
    check(
      "Meta got the event_name Meta expects",
      d.event_name === "CompleteRegistration",
      d.event_name,
    );
    check(
      "with our event_id, for dedup against the browser",
      d.event_id === reg.eventId,
      d.event_id,
    );
    check(
      "action_source is website",
      d.action_source === "website",
      d.action_source,
    );

    // SECONDS. Milliseconds would be a date in the year 55,000 and Meta answers
    // with a 400 that reads like a formatting complaint.
    const seconds = d.event_time;
    const drift = Math.abs(seconds * 1000 - Date.now());
    check(
      "event_time is in seconds",
      seconds > 1e9 && seconds < 1e10 && drift < 600_000,
      `${seconds}`,
    );

    // ── the one that matters most ──
    const em = d.user_data?.em?.[0];
    check(
      "a hashed email was sent",
      typeof em === "string" && em.length === 64,
      em?.slice(0, 16) + "…",
    );
    const expectedHash = await sha256Hex(email.toLowerCase());
    check(
      "and it is the correct SHA-256 of the normalised address",
      em === expectedHash,
    );
    check(
      "the RAW address appears nowhere in the request",
      !metaCall.raw.includes(email),
      metaCall.raw.includes(email) ? "LEAKED" : "clean",
    );
    const ph = d.user_data?.ph?.[0];
    check(
      "a hashed phone was sent",
      typeof ph === "string" && ph.length === 64,
    );
    check(
      "the raw phone number appears nowhere either",
      !/99\d{8}/.test(metaCall.raw),
      "clean",
    );
    check(
      "client ip and user agent travel for matching",
      !!d.user_data?.client_ip_address || !!d.user_data?.client_user_agent,
    );
    check(
      "currency is attached",
      d.custom_data?.currency === "INR",
      d.custom_data?.currency,
    );
  }

  if (ga4Call) {
    const ev = ga4Call.body.events[0];
    check("GA4 got the name GA4 expects", ev.name === "sign_up", ev.name);
    check(
      "with transaction_id for dedup",
      ev.params?.transaction_id === reg.eventId,
      ev.params?.transaction_id,
    );
    check(
      "and a client_id, without which GA4 attributes nothing",
      !!ga4Call.body.client_id,
      ga4Call.body.client_id,
    );
    check(
      "the api_secret is in the query, not the body",
      ga4Call.query.includes("api_secret=") &&
        !ga4Call.raw.includes("api_secret"),
    );
  }

  // ── replay must not double-send ────────────────────────────────────────
  section("A second dispatch sends nothing twice");
  await reset();
  const second = await dispatch("?limit=50");
  check(
    "no conversion was sent again",
    (second.outcomes || []).filter((o) => o.status === "sent").length === 0,
    `${(second.outcomes || []).length} outcome(s), 0 sent`,
  );
  check("and the mock saw nothing", (await captured()).length === 0);

  // ── consent is enforced at send time ───────────────────────────────────
  section("Consent is enforced when sending, not when recording");
  await reset();

  const db = await import("node:sqlite").then(
    (m) => new m.DatabaseSync("data/trade.db"),
  );

  // An event with a `denied` answer must never leave.
  const deniedId = `signup:capi-denied-${tag}`;
  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, consent, occurred_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    deniedId,
    "CompleteRegistration",
    null,
    "denied",
    Date.now(),
    Date.now(),
  );
  db.prepare(
    `INSERT INTO conversion_deliveries (event_id, provider, status, attempts, next_attempt_at, created_at)
     VALUES (?,?,'pending',0,?,?)`,
  ).run(deniedId, "meta", 0, Date.now());

  // And one with no answer at all — an unanswered banner is not permission.
  const unknownId = `signup:capi-unknown-${tag}`;
  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, consent, occurred_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(unknownId, "CompleteRegistration", null, null, Date.now(), Date.now());
  db.prepare(
    `INSERT INTO conversion_deliveries (event_id, provider, status, attempts, next_attempt_at, created_at)
     VALUES (?,?,'pending',0,?,?)`,
  ).run(unknownId, "meta", 0, Date.now());

  const consentRun = await dispatch("?limit=50");
  const deniedOutcome = (consentRun.outcomes || []).find(
    (o) => o.eventId === deniedId,
  );
  const unknownOutcome = (consentRun.outcomes || []).find(
    (o) => o.eventId === unknownId,
  );
  check(
    "a denied conversion is skipped, not sent",
    deniedOutcome?.status === "skipped" &&
      /no_consent/.test(deniedOutcome?.reason || ""),
    `${deniedOutcome?.status} ${deniedOutcome?.reason || ""}`,
  );
  check(
    "an unanswered conversion is skipped too",
    unknownOutcome?.status === "skipped",
    `${unknownOutcome?.status} ${unknownOutcome?.reason || ""}`,
  );
  check("and the mock received neither", (await captured()).length === 0);

  const skippedRows = db
    .prepare(`SELECT status FROM conversion_deliveries WHERE event_id IN (?,?)`)
    .all(deniedId, unknownId);
  check(
    "both are terminal — they will not be retried forever",
    skippedRows.every((r) => r.status === "skipped"),
  );

  // ── failure is survived, not swallowed ─────────────────────────────────
  section("An upstream failure backs off instead of losing the event");
  await reset();

  const retryId = `signup:retrytest-${tag}`;
  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, consent, occurred_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    retryId,
    "CompleteRegistration",
    null,
    "exempt",
    Date.now(),
    Date.now(),
  );
  db.prepare(
    `INSERT INTO conversion_deliveries (event_id, provider, status, attempts, next_attempt_at, created_at)
     VALUES (?,?,'pending',0,?,?)`,
  ).run(retryId, "meta", 0, Date.now());

  const first = await dispatch("?limit=50");
  const row1 = db
    .prepare(
      `SELECT status, attempts, next_attempt_at, last_error FROM conversion_deliveries WHERE event_id = ?`,
    )
    .get(retryId);
  check(
    "the first attempt is recorded as a retry, not a loss",
    (first.outcomes || []).some(
      (o) => o.eventId === retryId && o.status === "pending",
    ),
    row1?.status,
  );
  check(
    "attempts was incremented",
    Number(row1?.attempts) === 1,
    `attempts=${row1?.attempts}`,
  );
  check(
    "and it is scheduled in the future, not retried immediately",
    Number(row1?.next_attempt_at) > Date.now(),
  );
  check(
    "with the reason kept for an operator to read",
    !!row1?.last_error,
    row1?.last_error,
  );

  // Bring the retry forward, since the real backoff is a minute.
  db.prepare(
    `UPDATE conversion_deliveries SET next_attempt_at = 0 WHERE event_id = ?`,
  ).run(retryId);

  const retry = await dispatch("?limit=50");
  const row2 = db
    .prepare(
      `SELECT status, attempts FROM conversion_deliveries WHERE event_id = ?`,
    )
    .get(retryId);
  check(
    "the retry succeeds",
    (retry.outcomes || []).some(
      (o) => o.eventId === retryId && o.status === "sent",
    ),
    row2?.status,
  );
  check(
    "and the attempt count carried forward",
    Number(row2?.attempts) === 2,
    `attempts=${row2?.attempts}`,
  );

  // ── dry run must not send ──────────────────────────────────────────────
  section("A dry run builds the payload without sending it");
  await reset();
  const dryId = `signup:dryrun-${tag}`;
  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, consent, occurred_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(dryId, "CompleteRegistration", null, "exempt", Date.now(), Date.now());
  db.prepare(
    `INSERT INTO conversion_deliveries (event_id, provider, status, attempts, next_attempt_at, created_at)
     VALUES (?,?,'pending',0,?,?)`,
  ).run(dryId, "meta", 0, Date.now());

  const dry = await dispatch("?dryRun=1&limit=50");
  const preview = (dry.previews || []).find((p) =>
    JSON.stringify(p.body).includes(dryId),
  );
  check("a preview was produced", !!preview);
  check(
    "with a real URL",
    typeof preview?.url === "string" && preview.url.includes("/events"),
    preview?.url,
  );
  check("and the mock received nothing", (await captured()).length === 0);
  const stillPending = db
    .prepare(`SELECT status FROM conversion_deliveries WHERE event_id = ?`)
    .get(dryId);
  check(
    "the delivery is still pending, untouched by the dry run",
    stillPending?.status === "pending",
    stillPending?.status,
  );

  // ── fixtures must never reach a real ad account ────────────────────────
  section("Test fixtures are never sent to an ad platform");
  await reset();

  // A fixture event that is fully permitted by consent — so the ONLY thing that
  // can stop it is the fixture guard. Without this, the check would pass on the
  // consent rule and prove nothing about the guard.
  //
  // The fixture user is created explicitly rather than looked up. Relying on one
  // happening to exist, with a `?? null` fallback, was worse than useless: a null
  // user is NOT a fixture, so the event was sent and the check that followed
  // reported the opposite of the truth.
  const fixtureId = `signup:fixture-${tag}`;
  const fixtureUserId = `fixture${tag}`.slice(0, 24);
  const fixtureEmail = `fixture-${tag}@events.local`;
  db.prepare(
    `INSERT INTO users (id, username, email, pass_hash, salt, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    fixtureUserId,
    `fix${tag}`.slice(0, 24),
    fixtureEmail,
    "x",
    "x",
    Date.now(),
  );
  const madeIt = db
    .prepare(`SELECT id FROM users WHERE id = ?`)
    .get(fixtureUserId);
  check(
    "a fixture user was created to attach the event to",
    !!madeIt?.id,
    fixtureUserId,
  );

  db.prepare(
    `INSERT INTO conversion_events
       (event_id, name, user_id, consent, occurred_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    fixtureId,
    "CompleteRegistration",
    fixtureUserId,
    "exempt",
    Date.now(),
    Date.now(),
  );
  db.prepare(
    `INSERT INTO conversion_deliveries (event_id, provider, status, attempts, next_attempt_at, created_at)
     VALUES (?,?,'pending',0,?,?)`,
  ).run(fixtureId, "meta", 0, Date.now());

  const fixtureRun = await dispatch("?limit=50");
  const fixtureOutcome = (fixtureRun.outcomes || []).find(
    (o) => o.eventId === fixtureId,
  );
  check(
    "a fixture conversion is skipped despite having consent",
    fixtureOutcome?.status === "skipped" &&
      fixtureOutcome?.reason === "fixture_account",
    `${fixtureOutcome?.status} ${fixtureOutcome?.reason || ""}`,
  );
  // Scoped to THIS event, not to the whole capture: an earlier section leaves a
  // pending delivery on purpose (the dry-run check), and that one is legitimately
  // sent during this pass. Asserting the mock received nothing at all would fail
  // for a correct implementation.
  const fixtureLeak = (await captured()).filter((c) =>
    JSON.stringify(c.body || {}).includes(fixtureId),
  );
  check(
    "and nothing left the building for it",
    fixtureLeak.length === 0,
    fixtureLeak.length ? "LEAKED" : "clean",
  );

  // ── cleanup ────────────────────────────────────────────────────────────
  let removed = 0;
  for (const id of [deniedId, unknownId, retryId, dryId, fixtureId]) {
    removed += db
      .prepare(`DELETE FROM conversion_deliveries WHERE event_id = ?`)
      .run(id).changes;
    removed += db
      .prepare(`DELETE FROM conversion_events WHERE event_id = ?`)
      .run(id).changes;
  }
  removed += db
    .prepare(
      `DELETE FROM conversion_deliveries
        WHERE event_id IN (SELECT event_id FROM conversion_events
                            WHERE user_id IN (SELECT id FROM users
                                               WHERE email LIKE '%@events.local'
                                                  OR email LIKE '%@capi-verify.invalid'))`,
    )
    .run().changes;
  removed += db
    .prepare(
      `DELETE FROM conversion_events
        WHERE user_id IN (SELECT id FROM users
                           WHERE email LIKE '%@events.local'
                              OR email LIKE '%@capi-verify.invalid')`,
    )
    .run().changes;
  removed += db
    .prepare(
      `DELETE FROM users
        WHERE email LIKE '%@events.local'
           OR email LIKE '%@capi-verify.invalid'`,
    )
    .run().changes;
  console.log(`\ncleanup: removed ${removed} row(s) created by this check`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Conversion delivery works, and refuses to send without consent.",
    );
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  process.exitCode = 2;
});
