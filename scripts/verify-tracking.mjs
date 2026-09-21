// scripts/verify-tracking.mjs — Phase 1: ad click ids captured at first touch.
//
//   node scripts/verify-tracking.mjs [baseURL]
//
// The pixels do not exist yet. What exists is the snapshot they will read from,
// and it is the one thing that cannot be backfilled: an `fbclid` that was
// dropped on the way to the landing page is gone permanently. So this checks
// the two links in the chain that are easy to break and impossible to notice:
//
//   1. the short link carries the click id through the redirect, and still
//      refuses to carry anything that is not on the allowlist
//   2. the landing page's beacon writes it onto the click row
//
// A regression in either is invisible in the UI — the page looks perfect and the
// data is simply absent, months before anyone would notice the numbers are low.
//
// Exits 0 on pass, 1 on a failed check, 2 when the fixture partner is missing.
// Sets `process.exitCode` rather than calling `process.exit()`, because exiting
// while fetch still holds keep-alive sockets trips a libuv assertion on Windows.

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

// The re-seeded local partner. Only used to make the short link resolvable.
const CODE = process.env.PARTNER_CODE || "PT-DEMO01";

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

const api = (path) => `${BASE}${path}`;

/** A unique UA per run so the click is never swallowed by de-duplication. */
const RUN_UA = `verify-tracking/${Date.now()}`;

/** Ask the click endpoint to record a visit, and report what it kept. */
async function beacon(body) {
  const res = await fetch(api("/api/track/click"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": RUN_UA,
      "x-forwarded-for": "203.0.113.90",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

/** Follow the short link without actually following it. */
async function redirectOf(query) {
  const res = await fetch(api(`/r/${CODE.replace(/^PT-/, "")}${query}`), {
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") || "" };
}

async function main() {
  console.log(`Tracking verification against ${BASE}\n`);

  // ── the short link must survive the hop ────────────────────────────────
  section("Short link carries the ad click id");

  const plain = await redirectOf("");
  check("short link redirects", plain.status === 302, `status=${plain.status}`);
  if (!plain.location) {
    console.log("\nCannot continue without a resolvable short link.");
    console.log(`Is there an approved affiliate with code ${CODE}?`);
    process.exitCode = 2;
    return;
  }
  check(
    "unknown code falls back to the default page",
    plain.location.includes("/l/start"),
    plain.location,
  );

  const withFb = await redirectOf("?fbclid=IWAR_fake_123&c=reel-aug");
  check(
    "fbclid survives the redirect",
    withFb.location.includes("fbclid=IWAR_fake_123"),
    withFb.location,
  );
  check(
    "campaign tag still survives alongside it",
    withFb.location.includes("c=reel-aug"),
  );
  check(
    "the affiliate code is still attached",
    withFb.location.includes(`ref=${CODE}`),
  );

  const multi = await redirectOf(
    "?gclid=G_1&wbraid=W_2&msclkid=M_3&ttclid=T_4&utm_source=instagram&utm_medium=paid&utm_campaign=aug&utm_content=reel&utm_term=trading",
  );
  for (const p of [
    "gclid=G_1",
    "wbraid=W_2",
    "msclkid=M_3",
    "ttclid=T_4",
    "utm_source=instagram",
    "utm_medium=paid",
    "utm_campaign=aug",
    "utm_content=reel",
    "utm_term=trading",
  ])
    check(
      `allowlisted param forwarded: ${p.split("=")[0]}`,
      multi.location.includes(p),
    );

  // The rebuild exists to stop the redirect being steerable. Copying named keys
  // must not reopen that, so anything off-list is still dropped.
  const nasty = await redirectOf(
    "?evil=https://attacker.example&ref=PT-ATTACKER&next=//evil.com&c=x",
  );
  check(
    "off-allowlist param is NOT forwarded",
    !nasty.location.includes("evil"),
    nasty.location.slice(0, 90),
  );
  check(
    "a visitor cannot override the affiliate code",
    !nasty.location.includes("PT-ATTACKER"),
  );
  check(
    "the redirect host is still the configured site",
    new URL(nasty.location).origin === new URL(BASE).origin,
    new URL(nasty.location).origin,
  );

  // ── the beacon must persist them ───────────────────────────────────────
  section("Landing beam records the click ids");

  const kept = await beacon({
    code: CODE,
    slug: "start",
    campaign: "reel-aug",
    signals: {
      fbclid: "IWAR_fake_456",
      gclid: "G_keep_1",
      utm_source: "instagram",
      utm_medium: "paid",
    },
  });
  check("beacon accepted", kept.ok === true, `status=${kept.status}`);
  check(
    "click was recorded",
    kept.tracked === true,
    `reason=${kept.reason || "-"}`,
  );
  check(
    "all four params were kept",
    kept.signals === 4,
    `signals=${kept.signals}`,
  );

  const offlist = await beacon({
    code: CODE,
    slug: "start",
    signals: { fbclid: "OK_1", evil: "nope", password: "hunter2" },
  });
  check(
    "unknown keys in the body are dropped",
    offlist.signals === 1,
    `signals=${offlist.signals}`,
  );

  const empty = await beacon({ code: CODE, slug: "start", signals: {} });
  check("no signals is still a valid click", empty.tracked === true);
  check("and reports zero kept", empty.signals === 0);

  // ── existing guarantees must not have moved ────────────────────────────
  section("Nothing that worked before was broken");

  const preview = await beacon({
    code: CODE,
    slug: "start",
    preview: true,
    signals: { fbclid: "SHOULD_NOT_STORE" },
  });
  check(
    "a preview is still not recorded",
    preview.tracked === false && preview.reason === "preview",
    `reason=${preview.reason}`,
  );

  const unknown = await beacon({
    code: "PT-NOPE99",
    slug: "start",
    signals: { fbclid: "X" },
  });
  check(
    "an unknown code is still refused",
    unknown.tracked === false && unknown.reason === "unknown_code",
    `reason=${unknown.reason}`,
  );

  const noCode = await beacon({ code: "", signals: { fbclid: "X" } });
  check(
    "a missing code is still refused",
    noCode.tracked === false && noCode.reason === "no_code",
    `reason=${noCode.reason}`,
  );

  // ── the landing page must read them off its own URL ────────────────────
  section("Landing page forwards what it was given");

  const direct = await fetch(
    api(
      `/l/start?ref=${CODE}&c=direct-test&fbclid=IWAR_direct_789&utm_source=google`,
    ),
    { headers: { "user-agent": RUN_UA }, redirect: "manual" },
  );
  check(
    "landing page renders",
    direct.status === 200,
    `status=${direct.status}`,
  );
  const html = await direct.text();
  check(
    "the beacon payload includes the fbclid the page was served with",
    html.includes("IWAR_direct_789"),
    "found in server-rendered props",
  );

  // ── report ─────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("Ad click ids are captured at first touch.");
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  process.exitCode = 1;
});
