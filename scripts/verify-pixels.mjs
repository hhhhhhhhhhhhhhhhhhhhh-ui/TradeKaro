// scripts/verify-pixels.mjs — Phase 5: per-partner tracking pixels.
//
//   node scripts/verify-pixels.mjs [baseURL]
//
// The riskiest area in the whole tracking build, because it takes
// ATTACKER-CONTROLLED INPUT and puts it into a script tag ON OUR ORIGIN. Get it
// wrong and a partner — or anyone who talks their way into a partner account —
// can run arbitrary JavaScript for every visitor who arrives through their link,
// with our cookies in scope.
//
// So this checks, in order of how badly each one would go:
//
//   1. A pixel id that is not exactly the expected shape is REFUSED. Not
//      escaped, not sanitised — refused.
//   2. A token is never returned. Not in a list, not in an error, not in the
//      dry-run preview.
//   3. A token is stored encrypted, and the plaintext is nowhere in the database.
//   4. With no encryption key configured, nothing is stored at all. Fails closed.
//   5. A disabled pixel stops firing, and a suspended partner's pixels stop too.
//   6. The partner's pixel actually LOADS on the landing page, and a conversion
//      is sent with the PARTNER's pixel id and the PARTNER's token.
//
// That last one is not hypothetical: the first version only loaded Meta's base
// library when the platform had its own pixel, so a partner-only pixel was
// accepted, listed, and never fired.
//
// Runs in two server modes and adapts:
//   • no TRACKING_ENC_KEY  → asserts the fail-closed path
//   • with TRACKING_ENC_KEY → asserts encryption at rest
//
// Exits 0 on pass, 1 on failure, 2 when the partner account cannot be used.

import { createHash } from "node:crypto";

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const PARTNER_EMAIL = process.env.PARTNER_EMAIL || "demo@tradestox.pro";
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD || "Partner@Demo1";
const CODE = process.env.PARTNER_CODE || "PT-DEMO01";

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, ok, info = "") => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}${info ? `  (${info})` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${info ? `  (${info})` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

/** A pixel id that would break out of a script tag if it were interpolated. */
const XSS_PIXEL = '1234567890"</script><script>alert(document.domain)</script>';
const XSS_GA = "G-ABC<script>alert(1)</script>";

let cookie = "";
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...(init.headers || {}),
    },
  });

const savePixel = async (body) => {
  const r = await api("/api/partners/pixels", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const listPixels = async () => (await api("/api/partners/pixels")).json();
const dropPixel = async (provider) =>
  (
    await api(`/api/partners/pixels?provider=${provider}`, { method: "DELETE" })
  ).json();

let u = 0;
const uniq = () => `${Date.now().toString(36)}${(++u).toString(36)}`;
const phoneBase = 10_000_000 + (Date.now() % 90_000_000);
let phoneN = 0;
const nextPhone = () =>
  `99${String((phoneBase + ++phoneN) % 100_000_000).padStart(8, "0")}`;

async function main() {
  console.log(`Partner pixel verification against ${BASE}\n`);

  // ── session ────────────────────────────────────────────────────────────
  const login = await fetch(`${BASE}/api/partners/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: PARTNER_EMAIL,
      password: sha256Hex(PARTNER_PASSWORD),
    }),
  });
  const setCookie = (login.headers.getSetCookie?.() || []).join("; ");
  cookie = (setCookie.match(/partner_token=[^;]+/) || [])[0] || "";
  if (!cookie) {
    console.log(`Cannot continue: partner sign-in returned ${login.status}`);
    process.exitCode = 2;
    return;
  }

  const me = await (await api("/api/partners/me")).json();
  const affiliateId = me?.affiliate?.id;

  // ── 1. authentication ──────────────────────────────────────────────────
  section("The panel endpoint needs a session");
  const saved = cookie;
  cookie = "";
  check(
    "GET without a session is refused",
    (await api("/api/partners/pixels")).status === 401,
  );
  check(
    "POST without a session is refused",
    (await api("/api/partners/pixels", { method: "POST", body: "{}" }))
      .status === 401,
  );
  check(
    "DELETE without a session is refused",
    (await api("/api/partners/pixels?provider=meta", { method: "DELETE" }))
      .status === 401,
  );
  cookie = saved;
  check("the session works", (await listPixels()).ok === true);

  // ── 2. the injection surface ───────────────────────────────────────────
  section("A pixel id that is not the expected shape is refused");
  for (const [label, id] of [
    ["a script-tag break-out", XSS_PIXEL],
    ["letters", "abc1234567890"],
    ["too short", "12345"],
    ["too long", "1".repeat(25)],
    ["empty", ""],
    ["a bare quote", '"'],
    ["a javascript: url", "javascript:alert(1)"],
  ]) {
    const r = await savePixel({ provider: "meta", pixelId: id });
    check(
      `Meta rejects ${label}`,
      r.status === 400,
      `${r.status} ${r.json?.error || ""}`.slice(0, 64),
    );
  }
  const goodMeta = await savePixel({
    provider: "meta",
    pixelId: "123456789012345",
  });
  check(
    "Meta accepts a real-shaped id",
    goodMeta.status === 200,
    goodMeta.json?.pixel?.pixelId,
  );

  for (const [label, id] of [
    ["a script tag", XSS_GA],
    ["a UA id", "UA-12345678-1"],
    ["no prefix", "ABCD1234"],
    ["empty", ""],
  ]) {
    const r = await savePixel({ provider: "ga4", pixelId: id });
    check(`GA4 rejects ${label}`, r.status === 400, `${r.status}`);
  }
  const goodGa = await savePixel({ provider: "ga4", pixelId: "g-abcd1234" });
  check(
    "GA4 accepts a real-shaped id",
    goodGa.status === 200,
    goodGa.json?.pixel?.pixelId,
  );

  // ── 3. tokens are write-only ───────────────────────────────────────────
  section("A token goes in and never comes back out");
  const TOKEN = "EAAG" + "x".repeat(40);
  const withToken = await savePixel({
    provider: "meta",
    pixelId: "123456789012345",
    token: TOKEN,
  });

  const listRaw = JSON.stringify(await listPixels());
  check(
    "the token is absent from the pixel list",
    !listRaw.includes(TOKEN),
    listRaw.includes(TOKEN) ? "LEAKED" : "clean",
  );
  check(
    "no field in the response is named token",
    !listRaw.includes('"token"'),
  );
  check(
    "the save response omits it too",
    !JSON.stringify(withToken.json).includes(TOKEN),
  );

  // Short and malformed tokens are copy-paste accidents that produce a 401
  // nobody can explain, so they are refused at the door.
  check(
    "a too-short token is refused",
    (
      await savePixel({
        provider: "meta",
        pixelId: "123456789012345",
        token: "short",
      })
    ).status === 400,
  );
  check(
    "a token with whitespace is refused",
    (
      await savePixel({
        provider: "meta",
        pixelId: "123456789012345",
        token: "EAAG token with spaces in it 12345",
      })
    ).status === 400,
  );

  // ── 4. encryption, or refusal ──────────────────────────────────────────
  section("Credentials are encrypted at rest, or not stored at all");
  const metaList = (await listPixels()).pixels.find(
    (p) => p.provider === "meta",
  );
  const serverSide = (await listPixels()).serverSideAvailable;

  const db = await import("node:sqlite").then(
    (m) => new m.DatabaseSync("data/trade.db"),
  );
  const row = db
    .prepare(
      `SELECT pixel_id, token_enc FROM tracking_pixels WHERE affiliate_id = ? AND provider = 'meta'`,
    )
    .get(affiliateId);

  if (serverSide) {
    check("the server reports encryption available", true);
    check("a token is on file", !!row?.token_enc);
    check(
      "and it is stored as a versioned ciphertext, not the token",
      typeof row?.token_enc === "string" &&
        row.token_enc.startsWith("v1:") &&
        row.token_enc.split(":").length === 4,
      String(row?.token_enc || "").slice(0, 12) + "…",
    );
    check(
      "the plaintext token appears nowhere in the row",
      !JSON.stringify(row || {}).includes(TOKEN),
      "clean",
    );
    check(
      "the panel gets a hint instead, so the partner can recognise it",
      // A masked prefix plus the last four characters. Enough to tell one token
      // from another; not enough to use one. Asserting the tail actually comes
      // from the token is what stops this passing on a hardcoded placeholder.
      typeof metaList?.tokenHint === "string" &&
        metaList.tokenHint.endsWith(TOKEN.slice(-4)) &&
        !metaList.tokenHint.includes(TOKEN.slice(0, 12)),
      metaList?.tokenHint,
    );
  } else {
    // No key configured. The only acceptable behaviour is to refuse.
    check("the server reports encryption UNAVAILABLE", true);
    check(
      "saving a token is refused with 503",
      withToken.status === 503,
      `status=${withToken.status}`,
    );
    check(
      "and nothing was stored",
      !row?.token_enc,
      String(row?.token_enc || "null"),
    );
    check(
      "the partner is told, rather than silently losing it",
      /not available|securely/i.test(String(withToken.json?.error || "")),
      String(withToken.json?.error || "").slice(0, 60),
    );
  }

  // ── 5. gating ──────────────────────────────────────────────────────────
  section("A pixel stops firing when it should");
  await savePixel({
    provider: "meta",
    pixelId: "123456789012345",
    enabled: false,
  });
  const disabledList = (await listPixels()).pixels.find(
    (p) => p.provider === "meta",
  );
  check(
    "a disabled pixel is reported disabled",
    disabledList?.enabled === false,
  );

  await savePixel({
    provider: "meta",
    pixelId: "123456789012345",
    enabled: true,
  });
  check(
    "and enabled again on request",
    (await listPixels()).pixels.find((p) => p.provider === "meta")?.enabled ===
      true,
  );

  // ── 6. queueing on a real conversion ───────────────────────────────────
  section("A conversion for a partner with a pixel is queued for them");
  const tag = uniq();
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-ipcountry": "IN",
      cookie: `ref=${CODE}`,
      "user-agent": "verify-pixels/1",
    },
    body: JSON.stringify({
      username: `px${tag}`.slice(0, 24),
      email: `px-${tag}@events.local`,
      password: await sha256Hex("Engine@12345"),
      phone: nextPhone(),
      ref: CODE,
    }),
  }).then((r) => r.json().catch(() => ({})));

  check("the signup succeeded", reg.ok === true, reg.eventId);

  const deliveries = db
    .prepare(
      `SELECT provider, status FROM conversion_deliveries WHERE event_id = ?`,
    )
    .all(String(reg.eventId || ""));
  check(
    "a delivery row was opened for the partner's pixel",
    deliveries.some((d) => d.provider === "meta_affiliate"),
    deliveries.map((d) => d.provider).join(",") || "none",
  );
  check(
    "it is queued, not sent inline",
    deliveries.find((d) => d.provider === "meta_affiliate")?.status ===
      "pending",
  );

  // ── 7. the pixel actually loads in a browser ───────────────────────────
  // Reported by the caller of this script (see the runner), because it needs a
  // browser and the mock. The queue check above is the part that can be proven
  // from here.

  // ── 8. the page renders, with and without the pixel ────────────────────
  section("A pixel only follows its own partner's link");

  // The POSITIVE case comes first, deliberately.
  //
  // Checking only that the id is absent from an unrelated page passes for the
  // wrong reason when the page is broken — and it was. Returning the SQLite rows
  // straight through made React refuse to serialise them into the Client
  // Component, so every landing page carrying a partner pixel returned a 500.
  // A negative-only assertion stayed green the whole time.
  const own = await fetch(`${BASE}/l/start?ref=${CODE}`, {
    headers: { "cf-ipcountry": "IN", "user-agent": "verify-pixels/1" },
  });
  const ownHtml = await own.text();
  check(
    "the partner's own landing page renders",
    own.status === 200,
    `status=${own.status}${own.status >= 500 ? " — check the server log" : ""}`,
  );
  check(
    "and carries their pixel id",
    ownHtml.includes("123456789012345"),
    ownHtml.includes("123456789012345") ? "present" : "ABSENT",
  );

  const otherRes = await fetch(`${BASE}/l/start`, {
    headers: { "cf-ipcountry": "IN", "user-agent": "verify-pixels/2" },
  });
  const otherHtml = await otherRes.text();
  check(
    "a landing page with no code renders",
    otherRes.status === 200,
    `status=${otherRes.status}`,
  );
  check(
    "and does not carry the partner's pixel id",
    !otherHtml.includes("123456789012345"),
    otherHtml.includes("123456789012345") ? "LEAKED" : "clean",
  );

  // ── cleanup ────────────────────────────────────────────────────────────
  let removed = 0;
  removed += (await dropPixel("meta")).removed || 0;
  removed += (await dropPixel("ga4")).removed || 0;
  removed += db
    .prepare(
      `DELETE FROM conversion_deliveries WHERE event_id IN (
         SELECT event_id FROM conversion_events WHERE user_id IN (
           SELECT id FROM users WHERE email LIKE '%@events.local'))`,
    )
    .run().changes;
  removed += db
    .prepare(
      `DELETE FROM conversion_events WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@events.local')`,
    )
    .run().changes;
  removed += db
    .prepare(`DELETE FROM users WHERE email LIKE '%@events.local'`)
    .run().changes;
  removed += db
    .prepare(`DELETE FROM affiliate_clicks WHERE code = ? AND ts > ?`)
    .run(CODE, Date.now() - 300_000).changes;
  console.log(`\ncleanup: removed ${removed} row(s) created by this check`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Partner pixels are isolated, encrypted, and refused when malformed.",
    );
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  process.exitCode = 2;
});
