// scripts/verify-wiring.mjs — is the affiliate system actually connected?
//
//   node scripts/verify-wiring.mjs [baseURL]
//
// The other suites prove behaviour in depth. This one proves CONNECTION: every
// partner page resolves, every partner and operator endpoint answers, nothing is
// left open to the public, and — the part that is easy to fake and easy to get
// wrong — an action taken on one surface shows up on the other.
//
// Three flows run in both directions:
//   rate change     operator sets it   -> partner's own panel reports it
//   payout          partner requests   -> operator queue -> partner sees PAID
//   request         partner asks       -> operator answers -> partner reads it
//
// The payout flow moves real state, so it creates a payout and a payout account,
// tags both, and removes them at the end. It leaves the demo account as found.
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

const TAG = `wiring-${Date.now().toString(36)}`;
const MARK = `WIRINGTEST-${TAG}`;

let pass = 0;
let fail = 0;
const failures = [];
const checks = [];

function check(name, ok, info = "") {
  checks.push({ name, ok, info });
  if (ok) {
    pass++;
    console.log(`  ok    ${name}${info ? `  (${info})` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${info ? `  (${info})` : ""}`);
  }
}
const skip = (name, why) => console.log(`  skip  ${name}  (${why})`);
const section = (t) => console.log(`\n${t}`);
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const cookieOf = (r) => (r.headers.getSetCookie?.() || []).join("; ");
const pick = (c, n) => (c.match(new RegExp(`${n}=([^;]+)`)) || [])[1] || "";

const db = new DatabaseSync(DB_PATH);

async function login(path, email, password) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, cookie: cookieOf(r) };
}

/** a GET that never follows a redirect, so a 302 is visible as a 302 */
const probe = (path, headers = {}) =>
  fetch(BASE + path, { headers, redirect: "manual" });

async function main() {
  console.log(`Verifying affiliate wiring against ${BASE}`);

  const pLogin = await login(
    "/api/partners/login",
    PARTNER_EMAIL,
    sha256Hex(PARTNER_PASSWORD),
  );
  const partner = pick(pLogin.cookie, "partner_token");
  const aLogin = await login("/api/admin/login", ADMIN_EMAIL, ADMIN_PASSWORD);
  const admin = pick(aLogin.cookie, "admin_token");

  if (!partner || !admin) {
    console.log(
      `\nCannot continue: partner=${pLogin.status} admin=${aLogin.status}`,
    );
    return 2;
  }
  const PH = { cookie: `partner_token=${partner}` };
  const AH = { cookie: `admin_token=${admin}` };

  const me0 = await (
    await fetch(BASE + "/api/partners/me", { headers: PH })
  ).json();
  const aff = me0?.affiliate || {};
  const ORIGINAL_RATE = aff.depositRate;
  check(
    "partner session resolves",
    !!aff.id && !!aff.code,
    `${aff.code} · ${aff.model}`,
  );

  // ── 1 ───────────────────────────────────────────────────────────────────
  section("1. Every public partner page answers with no session");

  for (const p of ["/partners/login", "/partners/join"]) {
    const r = await probe(p);
    const html = await r.text();
    check(
      `${p} is publicly reachable`,
      r.status === 200 && html.includes("</html>"),
      `status=${r.status}`,
    );
  }
  const landing = await probe("/partners");
  check(
    "/partners is reachable",
    [200, 302, 307].includes(landing.status),
    `status=${landing.status}`,
  );

  // ── 2 ───────────────────────────────────────────────────────────────────
  section("2. Every partner panel page renders for a signed-in partner");

  const PAGES = [
    "/partners/dashboard",
    "/partners/links",
    "/partners/stats",
    "/partners/referrals",
    "/partners/earnings",
    "/partners/payouts",
    "/partners/profile",
  ];
  for (const p of PAGES) {
    const r = await probe(p, PH);
    const html = await r.text();
    check(
      `${p} renders`,
      r.status === 200 && html.includes("</html>"),
      `status=${r.status}${r.status === 200 ? "" : " — not a 200"}`,
    );
  }

  // ── 3 ───────────────────────────────────────────────────────────────────
  section("3. The partner API is closed to strangers");

  // Everything except login/register/logout, which must stay public.
  const PROTECTED = [
    "/api/partners/me",
    "/api/partners/links",
    "/api/partners/earnings",
    "/api/partners/referrals",
    "/api/partners/payouts",
    "/api/partners/accounts",
    "/api/partners/requests",
    "/api/partners/qr",
  ];
  for (const p of PROTECTED) {
    const r = await probe(p);
    check(
      `${p} refuses an anonymous caller`,
      r.status === 401,
      `status=${r.status}`,
    );
  }
  // A trader session must NOT open the partner surface. The two identities share
  // a secret and a signing scheme, so this is the check that they stay separate.
  // One username, reused for the signup AND the login. Generating it twice made
  // the login ask for an account that was never created, so there was no token
  // and the check below passed vacuously — a false pass, which is the one kind
  // of green worth hunting down.
  const tname = `wiring_${Date.now().toString(36)}`;
  const trader = await fetch(BASE + "/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: tname,
      email: `${tname}@wiring.local`,
      password: "Wiring@1234",
      phone: "9" + String(Date.now()).slice(-9),
    }),
  });
  const tlog = await fetch(BASE + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tname, password: "Wiring@1234" }),
  });
  const tok = (await tlog.json().catch(() => null))?.token || "";
  if (trader.status !== 200 || !tok) {
    skip(
      "a trader session cannot read the partner API",
      `no trader token (register=${trader.status} login=${tlog.status})`,
    );
  } else {
    const asTrader = await probe("/api/partners/me", {
      cookie: `token=${tok}`,
    });
    check(
      "a trader session cannot read the partner API",
      asTrader.status === 401,
      `status=${asTrader.status}`,
    );
  }

  // ── 4 ───────────────────────────────────────────────────────────────────
  section("4. Every partner API answers a real partner");

  const CONTRACT = [
    ["/api/partners/me", ["affiliate"]],
    ["/api/partners/links", ["code", "landingPages", "totals"]],
    ["/api/partners/earnings", ["summary", "commissions", "terms"]],
    ["/api/partners/referrals", ["summary", "referrals", "campaigns"]],
    ["/api/partners/payouts", ["summary", "payouts", "accounts", "minPayout"]],
    ["/api/partners/accounts", ["accounts"]],
    ["/api/partners/requests", ["requests"]],
    ["/api/partners/qr", []],
  ];
  for (const [p, keys] of CONTRACT) {
    const r = await probe(p, PH);
    if (!keys.length) {
      const t = r.headers.get("content-type") || "";
      check(
        `${p} answers`,
        r.status === 200 && t.includes("svg"),
        `status=${r.status}`,
      );
      continue;
    }
    const j = await r.json().catch(() => null);
    const missing = keys.filter((k) => j?.[k] === undefined);
    check(
      `${p} answers with the shape the panel expects`,
      r.status === 200 && missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `status=${r.status}`,
    );
  }

  // ── 5 ───────────────────────────────────────────────────────────────────
  section("5. Operator endpoints answer, and refuse a partner session");

  const ADMIN_APIS = [
    "/api/admin/affiliates",
    "/api/admin/affiliate-payouts",
    "/api/admin/affiliate-requests",
  ];
  for (const p of ADMIN_APIS) {
    const ok = await probe(p, AH);
    const anon = await probe(p);
    const asPartner = await probe(p, PH);
    check(
      `${p}: operator 200, anonymous blocked, partner blocked`,
      ok.status === 200 &&
        [401, 403].includes(anon.status) &&
        [401, 403].includes(asPartner.status),
      `operator=${ok.status} anon=${anon.status} partner=${asPartner.status}`,
    );
  }
  const rec = await probe("/api/admin/affiliate-reconcile", AH);
  const recAnon = await probe("/api/admin/affiliate-reconcile");
  check(
    "/api/admin/affiliate-reconcile: operator 200, anonymous blocked",
    rec.status === 200 && [401, 403].includes(recAnon.status),
    `operator=${rec.status} anon=${recAnon.status}`,
  );

  // ── 6 ───────────────────────────────────────────────────────────────────
  section("6. DIRECTION 1 — operator changes a rate, partner sees it");

  const NEW_RATE = ORIGINAL_RATE === 21 ? 22 : 21;
  const setRate = async (rate) =>
    (
      await fetch(BASE + "/api/admin/affiliates", {
        method: "POST",
        headers: { ...AH, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          id: aff.id,
          depositRate: rate,
        }),
      })
    ).status;

  check("operator writes a new rate", (await setRate(NEW_RATE)) === 200);
  const me1 = await (
    await fetch(BASE + "/api/partners/me", { headers: PH })
  ).json();
  check(
    "the partner's own panel reports the new rate",
    me1?.affiliate?.depositRate === NEW_RATE,
    `partner sees ${me1?.affiliate?.depositRate}%, operator wrote ${NEW_RATE}%`,
  );
  const earn1 = await (
    await fetch(BASE + "/api/partners/earnings", { headers: PH })
  ).json();
  check(
    "and the partner's commission terms agree",
    earn1?.terms?.depositRate === NEW_RATE,
    `terms.depositRate=${earn1?.terms?.depositRate}`,
  );
  check(
    "rate restored",
    (await setRate(ORIGINAL_RATE)) === 200,
    `${ORIGINAL_RATE}%`,
  );

  // ── 7 ───────────────────────────────────────────────────────────────────
  section("7. DIRECTION 2 — partner requests a payout, operator pays it");

  let createdAccountId = "";
  let createdPayoutId = "";
  const state = await (
    await fetch(BASE + "/api/partners/payouts", { headers: PH })
  ).json();
  const minPayout = Number(state?.minPayout) || 0;
  const available = Number(state?.summary?.available) || 0;
  const openAlready = (state?.payouts || []).some((p) =>
    ["requested", "approved"].includes(String(p.status)),
  );

  if (openAlready) {
    skip(
      "payout round trip",
      "the demo account already has an open payout request",
    );
  } else if (available < minPayout || minPayout <= 0) {
    skip(
      "payout round trip",
      `available ₹${available} is below the ₹${minPayout} minimum`,
    );
  } else {
    if (!(state?.accounts || []).length) {
      const acc = await fetch(BASE + "/api/partners/accounts", {
        method: "POST",
        headers: { ...PH, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          kind: "upi",
          label: MARK,
          holder: "Wiring Check",
          upiId: "wiring@upi",
          makeDefault: true,
        }),
      });
      const aj = await acc.json().catch(() => null);
      createdAccountId = aj?.account?.id || aj?.id || "";
      check(
        "partner can add a payout destination",
        acc.status === 200,
        `status=${acc.status}`,
      );
    } else {
      skip("partner can add a payout destination", "one already exists");
    }

    const req = await fetch(BASE + "/api/partners/payouts", {
      method: "POST",
      headers: { ...PH, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: minPayout, note: MARK }),
    });
    const rj = await req.json().catch(() => null);
    createdPayoutId = rj?.id || "";
    check(
      "partner can request a payout",
      req.status === 200 && !!createdPayoutId,
      rj?.error || `status=${req.status} id=${createdPayoutId}`,
    );

    if (createdPayoutId) {
      const queue = await (
        await fetch(BASE + "/api/admin/affiliate-payouts?status=requested", {
          headers: AH,
        })
      ).json();
      check(
        "the request appears in the operator queue",
        (queue?.queue || []).some((q) => q.id === createdPayoutId),
        `${(queue?.queue || []).length} in queue`,
      );

      const step = async (status, extra = {}) =>
        (
          await fetch(BASE + "/api/admin/affiliate-payouts", {
            method: "POST",
            headers: { ...AH, "Content-Type": "application/json" },
            body: JSON.stringify({ id: createdPayoutId, status, ...extra }),
          })
        ).status;
      check("operator approves it", (await step("approved")) === 200);
      check(
        "operator marks it paid",
        (await step("paid", { utr: MARK })) === 200,
      );

      const back = await (
        await fetch(BASE + "/api/partners/payouts", { headers: PH })
      ).json();
      const mine = (back?.payouts || []).find((p) => p.id === createdPayoutId);
      check(
        "the partner sees it as PAID",
        mine?.status === "paid",
        `status=${mine?.status}`,
      );
      check(
        "and the partner's paid total moved",
        Number(back?.summary?.paid) >= minPayout,
        `paid=₹${back?.summary?.paid}`,
      );
    }
  }

  // ── 8 ───────────────────────────────────────────────────────────────────
  section("8. DIRECTION 3 — partner asks, operator answers, partner reads it");

  const asked = await fetch(BASE + "/api/partners/requests", {
    method: "POST",
    headers: { ...PH, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "creative",
      title: MARK,
      detail: "Wiring check.",
    }),
  });
  const askedJson = await asked.json().catch(() => null);
  const reqId = askedJson?.id || "";
  check(
    "partner can raise a request",
    asked.status === 200 && !!reqId,
    askedJson?.error || "",
  );

  if (reqId) {
    const q = await (
      await fetch(BASE + "/api/admin/affiliate-requests?status=open", {
        headers: AH,
      })
    ).json();
    check(
      "it reaches the operator",
      (q?.requests || []).some((r) => r.id === reqId),
    );

    const decided = await fetch(BASE + "/api/admin/affiliate-requests", {
      method: "POST",
      headers: { ...AH, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reqId,
        status: "done",
        note: `${MARK} answered`,
      }),
    });
    check(
      "operator can answer it",
      decided.status === 200,
      `status=${decided.status}`,
    );

    const seen = await (
      await fetch(BASE + "/api/partners/requests", { headers: PH })
    ).json();
    const row = (seen?.requests || []).find((r) => r.id === reqId);
    check("the partner sees the answer", row?.status === "done", row?.status);
    check(
      "and the operator's note reaches them",
      String(row?.note || "").includes(MARK),
      row?.note || "no note",
    );
  }

  // ── 9 ───────────────────────────────────────────────────────────────────
  section("9. The panel's own navigation has no dead links");

  const shell = await (await probe("/partners/dashboard", PH)).text();
  const hrefs = [...shell.matchAll(/href="(\/partners[^"?#]*)"/g)].map(
    (m) => m[1],
  );
  const unique = [...new Set(hrefs)].filter(
    (h) => !h.startsWith("/partners/join"),
  );
  let dead = 0;
  for (const h of unique) {
    const r = await probe(h, PH);
    if (![200, 302, 307].includes(r.status)) {
      dead++;
      console.log(`        dead: ${h} -> ${r.status}`);
    }
  }
  check(
    "every link in the partner panel resolves",
    dead === 0,
    `${unique.length} link(s) checked, ${dead} dead`,
  );

  // ── cleanup ─────────────────────────────────────────────────────────────
  let removed = 0;
  if (createdPayoutId) {
    removed += db
      .prepare("DELETE FROM affiliate_payouts WHERE id = ?")
      .run(createdPayoutId).changes;
  }
  removed += db
    .prepare("DELETE FROM affiliate_payouts WHERE note = ? OR utr = ?")
    .run(MARK, MARK).changes;
  removed += db
    .prepare("DELETE FROM affiliate_requests WHERE title = ?")
    .run(MARK).changes;
  if (createdAccountId) {
    removed += db
      .prepare("DELETE FROM affiliate_payout_accounts WHERE id = ?")
      .run(createdAccountId).changes;
  }
  removed += db
    .prepare("DELETE FROM affiliate_payout_accounts WHERE label = ?")
    .run(MARK).changes;
  removed += db
    .prepare("DELETE FROM users WHERE email LIKE '%@wiring.local'")
    .run().changes;
  console.log(`\ncleanup: removed ${removed} row(s) created by this check`);

  return fail ? 1 : 0;
}

const rc = await main();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(
    `\nFailed checks:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
  );
} else if (rc === 0) {
  console.log("The affiliate system is wired end to end.");
}

process.exitCode = rc;
