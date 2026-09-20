// scripts/verify-attribution.mjs — the money path, end to end.
//
//   node scripts/verify-attribution.mjs [baseURL]
//
// verify-links.mjs proves a click is counted properly. This proves what the
// click is FOR: that a visit turns into an account owned by the right partner,
// that the deposit that follows pays them, and — just as important — that a
// bogus or stale `ref` credits nobody.
//
// That last half is the part nobody thinks to test. Over-attribution is worse
// than under-attribution: it means paying a partner for a customer somebody
// else introduced, and it is invisible in every dashboard.
//
// Exits 0 on success, 1 on a failed check, 2 if it cannot sign in at all.

import { createHash } from "node:crypto";

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

const PARTNER_EMAIL = process.env.PARTNER_EMAIL || "demo@tradestox.pro";
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD || "Partner@Demo1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Demo@123456";

// Reserved TEST-NET-3 address: can never be real traffic, so any probe rows are
// identifiable exactly.
const PROBE_IP = "203.0.113.78";
const STAMP = Date.now();
const TAG = `attrib-${STAMP.toString(36)}`;
const TRADER_PW = "Attrib@1234";

// Trader phone numbers must be unique and 10 digits starting with 9. Deriving
// them from the timestamp alone only leaves ten possibilities, so every signup
// after the first handful collided on a 409 and the later checks failed for a
// reason that had nothing to do with attribution.
let phoneSeq = 0;

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

/** Partner sign-in sends sha256(password); the admin console sends plaintext. */
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

function cookieOf(res) {
  return (res.headers.getSetCookie?.() || []).join("; ");
}

function pick(cookieHeader, name) {
  return (cookieHeader.match(new RegExp(`${name}=([^;]+)`)) || [])[1] || "";
}

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

/** A fresh trader signup. `cookie` carries the referral, if any. */
async function registerTrader({ cookie = "", ref = "", campaign = "" } = {}) {
  phoneSeq += 1;
  const uname = `attrib_${STAMP}_${phoneSeq}`;
  const email = `${uname}@attrib.local`;
  const phone =
    "9" + String(STAMP).slice(-6) + String(phoneSeq).padStart(3, "0");
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + "/api/v1/auth/register", {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: uname,
      email,
      password: TRADER_PW,
      phone,
      ref,
      campaign,
    }),
  });
  return {
    status: r.status,
    username: uname,
    email,
    phone,
    json: await r.json().catch(() => null),
  };
}

/**
 * The console addresses a trader by their `users.id`, without the `u-` prefix.
 * The only way to that id over HTTP is to sign in as the account and read it
 * back from `getAccountDetails` — which is also a small proof in itself that
 * the account the partner was credited for is a real, working login.
 */
async function traderConsoleId(t) {
  const log = await fetch(BASE + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: t.username, password: TRADER_PW }),
  });
  const token = (await log.json().catch(() => null))?.token || "";
  if (!token) return "";
  const det = await fetch(BASE + "/api/v1/auth/getAccountDetails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: "{}",
  });
  const j = await det.json().catch(() => null);
  return String(j?.clientID || j?.userId || "").replace(/^u-/, "");
}

async function main() {
  console.log(`Verifying signup attribution against ${BASE}`);

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

  if (!partner) {
    console.log(
      `\nCannot continue: partner sign-in returned ${partnerLogin.status} ` +
        `${JSON.stringify(partnerLogin.json)}`,
    );
    return 2;
  }
  if (!admin) {
    console.log(
      `\nCannot continue: admin sign-in returned ${adminLogin.status}. ` +
        `Attribution cannot be checked without the console.`,
    );
    return 2;
  }

  const partnerHeaders = { cookie: `partner_token=${partner}` };
  const adminHeaders = { cookie: `admin_token=${admin}` };
  const getReferrals = async () =>
    (
      await fetch(BASE + "/api/partners/referrals", { headers: partnerHeaders })
    ).json();

  // The partner's own code, and the count of everything already attributed, so
  // each check can talk about what THIS run added.
  const meRes = await fetch(BASE + "/api/partners/me", {
    headers: partnerHeaders,
  });
  const me = await meRes.json().catch(() => null);
  const code = me?.affiliate?.code || "";
  check("partner session resolves to a code", !!code, code);

  const startReferrals = await getReferrals();
  const startCount = (startReferrals?.referrals || []).length;

  // ── 1. a click that becomes a customer ───────────────────────────────────
  //
  // This is the whole product. A visitor opens the partner's link, the click
  // beacon drops the `ref` cookie, and the signup that follows must be bound to
  // that partner permanently — with the campaign tag carried along, and the
  // click marked converted so the funnel is not permanently off by one.

  section("1. Click -> signup credits the partner");

  const clickRes = await fetch(BASE + "/api/track/click", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": `verify-attribution/${STAMP}`,
      "x-forwarded-for": PROBE_IP,
    },
    body: JSON.stringify({ code, slug: "start", campaign: TAG }),
  });
  const clickJson = await clickRes.json().catch(() => null);
  const refCookie = pick(cookieOf(clickRes), "ref");
  const campaignCookie = pick(cookieOf(clickRes), "ref_c");
  check("the click is recorded", clickJson?.tracked === true);
  check("the click drops the referral cookie", refCookie === code, refCookie);
  check(
    "the click drops the campaign cookie",
    campaignCookie === TAG,
    campaignCookie,
  );

  const signup = await registerTrader({
    cookie: `ref=${refCookie}; ref_c=${campaignCookie}`,
  });
  check(
    "the account is created",
    signup.status === 200,
    `status=${signup.status}`,
  );

  const afterSignup = await getReferrals();
  const referrals = afterSignup?.referrals || [];
  check(
    "the partner gained exactly one customer",
    referrals.length === startCount + 1,
    `${startCount} -> ${referrals.length}`,
  );

  // Newest first, so the row this run created is at the head.
  const row = referrals[0];
  check(
    "the new customer is owned by this partner",
    referrals.length > startCount,
  );
  check(
    "the campaign tag survived the round trip",
    row?.campaign === TAG,
    row?.campaign || "missing",
  );
  check(
    "the referral is filed as a signup, not a click",
    row?.landing === "signup",
    row?.landing || "missing",
  );
  check(
    "the customer shows a broker client code, not an email",
    !!row?.code && row.code !== "—" && !String(row.code).includes("@"),
    row?.code,
  );
  // Nothing earned yet — a signup on its own is not money.
  check(
    "a plain signup earns nothing yet",
    (row?.deposited || 0) === 0 && (row?.earned || 0) === 0,
    `deposited=${row?.deposited} earned=${row?.earned}`,
  );

  // The click and the signup must not be counted as two separate things in the
  // funnel: the click row is stamped with the new user id when it converts.
  const links = await (
    await fetch(BASE + "/api/partners/links", { headers: partnerHeaders })
  ).json();
  check(
    "the signup is reflected in the landing-page totals",
    (links?.landingPages || []).some((p) => p.signups > 0),
    `signups=${(links?.landingPages || []).map((p) => p.signups).join(",")}`,
  );

  // ── 2. the deposit pays the partner ──────────────────────────────────────

  section("2. The deposit that follows pays them");

  const userId = await traderConsoleId(signup);
  check(
    "the new account is a working login the console can address",
    !!userId,
    userId || "no client id",
  );

  const AMOUNT = 40000;
  const credit = await fetch(BASE + "/api/admin/clients", {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: userId,
      deposit: AMOUNT,
      depositNote: "verify-attribution probe",
    }),
  });
  check(
    "an operator can credit the account",
    credit.status === 200,
    `status=${credit.status}`,
  );

  const afterDeposit = await getReferrals();
  const paidRow = (afterDeposit?.referrals || []).find(
    (r) => r.campaign === TAG,
  );
  check(
    "the deposit is recorded against the partner",
    paidRow?.deposited === AMOUNT,
    `deposited=${paidRow?.deposited} expected=${AMOUNT}`,
  );
  check(
    "the deposit produced commission for the partner",
    (paidRow?.earned || 0) > 0,
    `earned=${paidRow?.earned} pending=${paidRow?.pending}`,
  );

  // Commission lands as `pending` until the holdback expires — the partner must
  // be able to tell that apart from money they can actually withdraw.
  const earnings = await (
    await fetch(BASE + "/api/partners/earnings", { headers: partnerHeaders })
  ).json();
  const totals = earnings?.totals || earnings?.summary || {};
  check(
    "holding commission is distinguished from available money",
    "pending" in totals || "holdback" in totals || "available" in totals,
    Object.keys(totals).slice(0, 6).join(",") || "no totals",
  );

  // ── 3. attribution must not over-attribute ───────────────────────────────
  //
  // Every one of these creates a real account that must be owned by NOBODY.

  section("3. A bad referral credits nobody");

  const countBeforeBad = (await getReferrals())?.referrals?.length || 0;

  const bogusSignup = await registerTrader({ cookie: "ref=PT-NOSUCHPARTNER" });
  check(
    "a signup with an unknown code still succeeds",
    bogusSignup.status === 200,
  );
  const unknownCode = await getReferrals();
  check(
    "an unknown code attributes nobody",
    (unknownCode?.referrals || []).length === countBeforeBad,
    `${countBeforeBad} -> ${(unknownCode?.referrals || []).length}`,
  );

  // A suspended partner's links keep working for the visitor but must stop
  // crediting them — that is what suspension has to mean.
  const pendingRes = await fetch(
    BASE + "/api/admin/affiliates?status=pending",
    { headers: adminHeaders },
  );
  const pending = await pendingRes.json().catch(() => null);
  const notApproved =
    (pending?.affiliates || pending?.rows || [])[0]?.code || "";
  if (!notApproved) {
    console.log("  skip  no non-approved affiliate to test against");
  } else {
    const staleSignup = await registerTrader({
      cookie: `ref=${notApproved}`,
    });
    check(
      "a signup through a stale link still succeeds",
      staleSignup.status === 200,
    );
    const afterStale = await getReferrals();
    check(
      "a non-approved partner is credited nothing",
      (afterStale?.referrals || []).length === countBeforeBad,
      `${notApproved} -> ${(afterStale?.referrals || []).length} referrals`,
    );
  }

  // The body fallback exists for signup forms that carry `ref` in their own URL
  // rather than relying on the cookie. It must work — and it must not be able to
  // outrank the cookie, or a crafted `ref` could steal a click that was already
  // recorded for someone else.
  const bodySignup = await registerTrader({
    ref: code,
    campaign: `${TAG}-body`,
  });
  const afterBody = await getReferrals();
  const bodyRow = (afterBody?.referrals || []).find(
    (r) => r.campaign === `${TAG}-body`,
  );
  check(
    "a ref carried in the body attributes when there is no cookie",
    !!bodyRow,
    bodyRow ? "attributed" : "not attributed",
  );

  const bothSignup = await registerTrader({
    cookie: `ref=${code}`,
    ref: "PT-NOSUCHPARTNER",
    campaign: `${TAG}-both`,
  });
  const afterBoth = await getReferrals();
  const bothRow = (afterBoth?.referrals || []).find(
    (r) => r.campaign === `${TAG}-both`,
  );
  check(
    "the cookie outranks a conflicting ref in the body",
    !!bothRow,
    bothRow ? "cookie won" : "not attributed",
  );

  return fail ? 1 : 0;
}

const code = await main();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(
    `\nFailed checks:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
  );
} else if (code === 0) {
  console.log("Attribution verified end to end.");
}

process.exitCode = code;
