// scripts/verify-consent.mjs — Phase 2: the geo-gated consent gate.
//
//   node scripts/verify-consent.mjs [baseURL]
//
// Two things are being proven here, and the second one is the important one:
//
//   1. The banner is offered in the places that require it and withheld
//      everywhere else. Getting this backwards is not a cosmetic bug — a banner
//      on Indian traffic costs signups for no legal reason, and no banner on
//      German traffic is the exposure the whole feature exists to avoid.
//
//   2. Each click records an HONEST consent state. `exempt` where no banner was
//      owed, filled in by the visitor where it was, and NULL when they were
//      asked and never answered. Phase 4 reads that column before forwarding
//      anything to Meta or Google, so a row that says `granted` without anyone
//      having granted it is worse than no row at all.
//
// The geo header is supplied per request, so this tests the real decision path
// rather than a reimplementation of it.
//
// Exits 0 on pass, 1 on a failed check, 2 when the server is unreachable.
// Sets `process.exitCode` rather than `process.exit()` — exiting while fetch
// still holds keep-alive sockets trips a libuv assertion on Windows.

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

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

let uaCounter = 0;
let ipCounter = 90;
const nextUa = () => `verify-consent/${Date.now()}/${++uaCounter}`;
const nextIp = () => `203.0.113.${++ipCounter}`;

/** Load a landing page as if the visitor were in `country`. */
async function landAs(country, query = "") {
  const headers = { "user-agent": nextUa() };
  if (country !== null) headers["cf-ipcountry"] = country;
  const res = await fetch(`${BASE}/l/start?ref=${CODE}${query}`, {
    headers,
    redirect: "manual",
  });
  const html = await res.text();
  // The gate renders this attribute on both the server and the client, so it is
  // present in the first response — no JavaScript required to read the verdict.
  const m = html.match(/data-consent-required="([01])"/);
  return {
    status: res.status,
    required: m ? m[1] === "1" : null,
    cookies: (res.headers.getSetCookie?.() || []).join("; "),
  };
}

/** Record a click as if the visitor were in `country`. */
async function beaconAs(country, extra = {}) {
  const headers = {
    "Content-Type": "application/json",
    "user-agent": nextUa(),
    "x-forwarded-for": nextIp(),
  };
  if (country !== null) headers["cf-ipcountry"] = country;
  const res = await fetch(`${BASE}/api/track/click`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code: CODE, slug: "start", ...extra }),
  });
  const json = await res.json().catch(() => ({}));
  return {
    ...json,
    status: res.status,
    setCookies: (res.headers.getSetCookie?.() || []).join("; "),
  };
}

async function main() {
  console.log(`Consent verification against ${BASE}\n`);

  // ── who is owed a banner ───────────────────────────────────────────────
  section("Banner is offered only where the law requires one");

  const REQUIRED = [
    ["DE", "Germany"],
    ["FR", "France"],
    ["IE", "Ireland"],
    ["IT", "Italy"],
    ["ES", "Spain"],
    ["PL", "Poland"],
    ["SE", "Sweden"],
    ["NL", "Netherlands"],
    ["IS", "Iceland (EEA, non-EU)"],
    ["NO", "Norway (EEA, non-EU)"],
    ["GB", "United Kingdom"],
    ["CH", "Switzerland"],
    ["BR", "Brazil"],
    ["KR", "South Korea"],
  ];
  const EXEMPT = [
    ["IN", "India"],
    ["US", "United States"],
    ["CA", "Canada"],
    ["AU", "Australia"],
    ["AE", "UAE"],
    ["SG", "Singapore"],
    ["JP", "Japan"],
    ["ZA", "South Africa"],
    ["NG", "Nigeria"],
    ["ID", "Indonesia"],
  ];

  for (const [cc, label] of REQUIRED) {
    const r = await landAs(cc);
    check(`${label} is asked`, r.required === true, `required=${r.required}`);
  }
  for (const [cc, label] of EXEMPT) {
    const r = await landAs(cc);
    check(
      `${label} is NOT asked`,
      r.required === false,
      `required=${r.required}`,
    );
  }

  // An UNKNOWN country is treated as not requiring a banner.
  //
  // This is a business decision, not a safety property, and it is the riskier of
  // the two defaults: if the geolocation header ever goes missing in production,
  // EEA visitors are treated as exempt and see no banner. The tradeoff is
  // documented at the top of app/lib/consent.ts. These checks exist so that
  // changing the default back is a deliberate act rather than a surprise — they
  // will fail loudly if it flips.
  const noHeader = await landAs(null);
  check(
    "a missing geolocation header does NOT trigger a banner",
    noHeader.required === false,
    `required=${noHeader.required}`,
  );
  const tor = await landAs("T1");
  check(
    "a Tor exit does NOT trigger a banner",
    tor.required === false,
    `required=${tor.required}`,
  );
  const unknownCc = await landAs("XX");
  check(
    "an unroutable address does NOT trigger a banner",
    unknownCc.required === false,
    `required=${unknownCc.required}`,
  );

  // ── the click records an honest state ──────────────────────────────────
  section("The click records where the visitor stands");

  const exemptClick = await beaconAs("IN");
  check(
    "an Indian visitor is recorded as exempt, not as an unanswered refusal",
    exemptClick.consentRequired === false,
    `consentRequired=${exemptClick.consentRequired}`,
  );

  const askedClick = await beaconAs("DE");
  check(
    "a German visitor is recorded as asked",
    askedClick.consentRequired === true,
    `consentRequired=${askedClick.consentRequired}`,
  );
  check("the click was still recorded", askedClick.tracked === true);
  check(
    "and it hands back a click id for the answer to attach to",
    /tc_cid=\d+/.test(askedClick.setCookies),
    (askedClick.setCookies.match(/tc_cid=\d+/) || ["none"])[0],
  );

  const clickId = Number(
    (askedClick.setCookies.match(/tc_cid=(\d+)/) || [])[1],
  );

  // ── the answer lands on the right row ──────────────────────────────────
  section("The visitor's answer is written back");

  async function answer(decision, cid) {
    const res = await fetch(`${BASE}/api/track/consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-agent": "verify-consent/answer",
        // The click id travels in a cookie, not the body: if the client could
        // name which click to update, it could name someone else's.
        ...(cid ? { cookie: `tc_cid=${cid}` } : {}),
      },
      body: JSON.stringify({ decision }),
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  }

  const granted = await answer("granted", clickId);
  check(
    "accepting updates the click",
    granted.ok === true && granted.updated === true,
    `updated=${granted.updated} reason=${granted.reason || "-"}`,
  );

  // A refusal recorded once must survive a replay, or consent is decorative.
  const flip = await answer("denied", clickId);
  check(
    "a second answer cannot overwrite the first",
    flip.updated === false,
    `updated=${flip.updated} reason=${flip.reason || "-"}`,
  );

  const badDecision = await answer("maybe", clickId);
  check(
    "an invented decision is rejected",
    badDecision.status === 400,
    `status=${badDecision.status}`,
  );

  const noClick = await answer("denied", null);
  check(
    "answering with no click to attach to is harmless, not an error",
    noClick.ok === true && noClick.updated === false,
    `reason=${noClick.reason}`,
  );

  const forged = await answer("denied", 999999999);
  check(
    "an unknown click id updates nothing",
    forged.ok === true && forged.updated === false,
  );

  // ── nothing that worked before was broken ──────────────────────────────
  section("Tracking from Phase 1 still works");

  const withSignals = await beaconAs("IN", {
    signals: { fbclid: "IWAR_consent_check" },
  });
  check("ad click ids still recorded", withSignals.signals === 1);
  check("and still reported", withSignals.tracked === true);

  const preview = await beaconAs("DE", { preview: true });
  check(
    "a preview still records nothing",
    preview.tracked === false && preview.reason === "preview",
  );

  // ── report ─────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("Consent is geo-gated and recorded honestly.");
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  console.error("Is the server running?");
  process.exitCode = 2;
});
