// scripts/verify-links.mjs — end-to-end checks for the partner Links subsystem.
//
//   node scripts/verify-links.mjs [baseURL]
//
// Covers what smoke.mjs deliberately does not: the click accounting rules, the
// short link, the QR endpoint, and the request round trip to the admin console.
// These are the paths where a mistake is invisible in the UI and expensive in
// reality — a partner's click count is the number they will argue about.
//
// Every run uses a unique user agent, because clicks are de-duplicated per
// (code, day, device-hash). Without that the second run in one day would fail
// the "first click is unique" check for reasons that are not a bug.
//
// Override the credentials against a host that is not the local default:
//   PARTNER_EMAIL=… PARTNER_PASSWORD=… ADMIN_EMAIL=… ADMIN_PASSWORD=…
//
// Exits 0 when everything passes, 1 on a failed check, 2 when the accounts
// cannot be signed in to at all. It sets `process.exitCode` rather than calling
// `process.exit()`: exiting while fetch still holds keep-alive sockets trips an
// assertion in libuv on Windows and turns a clean pass into an abort.

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

// Unique per run so the de-duplication window is always empty at the start.
const RUN_UA = `verify-links/${Date.now()}`;
const RUN_IP = "203.0.113.77";

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

/**
 * The partner sign-in form hashes the password in the browser and sends only
 * the digest; the server scrypts that on top of a per-account salt. So a script
 * signing in as a partner has to send the digest too, not the password.
 * (The admin console is different — it takes the plaintext and hashes it server
 * side. That asymmetry is real, not a mistake in this file.)
 */
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

/** Join every Set-Cookie on a response into a request Cookie header. */
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
  const json = await r.json().catch(() => null);
  return { status: r.status, cookie: cookieOf(r), json };
}

/** POST a click the way a landing page does. */
async function click({ code, slug = "start", campaign = "", preview, ua }) {
  const r = await fetch(BASE + "/api/track/click", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": ua || RUN_UA,
      "x-forwarded-for": RUN_IP,
    },
    body: JSON.stringify({ code, slug, campaign, preview }),
  });
  return {
    status: r.status,
    json: await r.json().catch(() => null),
    cookie: cookieOf(r),
  };
}

async function main() {
  console.log(`Verifying partner links against ${BASE}`);

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

  const authHeaders = { cookie: `partner_token=${partner}` };
  const getLinks = async () =>
    (
      await fetch(BASE + "/api/partners/links", { headers: authHeaders })
    ).json();

  // ── 1. preview must not count ────────────────────────────────────────────
  //
  // This is the bug the whole `preview` flag exists for. Before it, a partner
  // clicking "Preview" on their own Links page inflated their own click count,
  // so the panel reported traffic that never existed.

  section("1. A preview is not a visit");

  const before = await getLinks();
  check(
    "links endpoint answers with totals",
    typeof before?.totals?.clicks === "number",
    `clicks=${before?.totals?.clicks} unique=${before?.totals?.unique}`,
  );

  const previewRes = await click({ code: before.code, preview: true });
  check(
    "preview click is not tracked",
    previewRes.json?.tracked === false,
    `reason=${previewRes.json?.reason}`,
  );
  check(
    "preview click reports the preview reason",
    previewRes.json?.reason === "preview",
  );
  check(
    "preview click sets no referral cookie",
    !pick(previewRes.cookie, "ref"),
  );

  const afterPreview = await getLinks();
  check(
    "preview left the click count untouched",
    afterPreview.totals.clicks === before.totals.clicks &&
      afterPreview.totals.unique === before.totals.unique,
    `${before.totals.clicks} -> ${afterPreview.totals.clicks}`,
  );

  // ── 2. de-duplication ────────────────────────────────────────────────────
  //
  // Every load writes a row, because the raw number is worth keeping. Only the
  // first from one device on one day is `unique`, and `unique` is what the panel
  // ranks by — otherwise whichever link a partner refreshes most looks best.

  section("2. One device, one day, one unique click");

  const first = await click({ code: before.code, slug: "start" });
  check("first click is recorded", first.json?.tracked === true);
  check("first click is unique", first.json?.unique === true);
  check("first click sets the referral cookie", !!pick(first.cookie, "ref"));
  check(
    "referral cookie carries the partner code",
    pick(first.cookie, "ref") === before.code,
    pick(first.cookie, "ref"),
  );

  const second = await click({ code: before.code, slug: "start" });
  check(
    "second click from the same device is still recorded",
    second.json?.tracked === true,
  );
  check("second click is not unique", second.json?.unique === false);

  // A tagged click has to drop the campaign cookie too. Both cookies ride on the
  // same response, so a bug that discards the referral cookie discards this one.
  const tagged = await click({
    code: before.code,
    slug: "start",
    campaign: "verify-campaign-tag",
  });
  check(
    "a tagged click records the campaign cookie",
    pick(tagged.cookie, "ref_c") === "verify-campaign-tag",
    pick(tagged.cookie, "ref_c") || "missing",
  );

  const afterTwo = await getLinks();
  check(
    "three loads added three clicks",
    afterTwo.totals.clicks === afterPreview.totals.clicks + 3,
    `${afterPreview.totals.clicks} -> ${afterTwo.totals.clicks}`,
  );
  check(
    "three loads added only one unique click",
    afterTwo.totals.unique === afterPreview.totals.unique + 1,
    `${afterPreview.totals.unique} -> ${afterTwo.totals.unique}`,
  );

  // A different device is a different person and must count again — otherwise
  // the rule above would be hiding real traffic rather than hiding a refresh.
  const otherDevice = await click({
    code: before.code,
    slug: "start",
    ua: `${RUN_UA}/phone`,
  });
  check(
    "a different device counts as unique again",
    otherDevice.json?.unique === true,
  );

  const afterThree = await getLinks();
  check(
    "the four loads net out to 4 clicks and 2 unique",
    afterThree.totals.clicks === before.totals.clicks + 4 &&
      afterThree.totals.unique === before.totals.unique + 2,
    `clicks +${afterThree.totals.clicks - before.totals.clicks}, unique +${
      afterThree.totals.unique - before.totals.unique
    }`,
  );

  // ── 3. codes that must not be attributed ─────────────────────────────────

  section("3. Unknown and empty codes are ignored");

  const bogus = await click({ code: "PT-NOSUCHPARTNER" });
  check("unknown code is not tracked", bogus.json?.tracked === false);
  check("unknown code reports why", bogus.json?.reason === "unknown_code");
  check("unknown code sets no cookie", !pick(bogus.cookie, "ref"));

  const empty = await click({ code: "" });
  check("empty code is not tracked", empty.json?.tracked === false);
  check("empty code reports why", empty.json?.reason === "no_code");

  // ── 4. short links ───────────────────────────────────────────────────────
  //
  // The short link redirects to the landing page and must NOT record the click
  // itself. If it did, every visitor who followed one would be counted twice.

  section("4. Short links redirect, and record nothing");

  const preShort = await getLinks();

  const shortRes = await fetch(`${BASE}/r/${before.shortCode}`, {
    redirect: "manual",
  });
  const shortTo = shortRes.headers.get("location") || "";
  check(
    "bare short code redirects",
    shortRes.status === 302 || shortRes.status === 307,
    `${shortRes.status} -> ${shortTo}`,
  );
  check("short link targets the landing page", shortTo.includes("/l/start"));
  check(
    "short link carries the affiliate code",
    shortTo.includes(`ref=${before.code}`),
  );
  check(
    "short link is not cached",
    /no-store/.test(shortRes.headers.get("cache-control") || ""),
  );

  const shortPrefixed = await fetch(`${BASE}/r/${before.code}`, {
    redirect: "manual",
  });
  const prefixedTo = shortPrefixed.headers.get("location") || "";
  check(
    "PT- prefixed code works too",
    prefixedTo.includes(`ref=${before.code}`),
    prefixedTo,
  );

  const shortSlug = await fetch(
    `${BASE}/r/${before.shortCode}/options?c=test-tag`,
    {
      redirect: "manual",
    },
  );
  const slugTo = shortSlug.headers.get("location") || "";
  check("short link accepts a landing page", slugTo.includes("/l/options"));
  check("short link preserves the campaign tag", slugTo.includes("c=test-tag"));

  const shortBad = await fetch(`${BASE}/r/NOSUCHPARTNER`, {
    redirect: "manual",
  });
  const badTo = shortBad.headers.get("location") || "";
  check(
    "a dead short link still reaches the product",
    badTo.includes("/l/"),
    badTo,
  );
  check("a dead short link attributes nobody", !badTo.includes("ref="));

  const postShort = await getLinks();
  check(
    "following short links recorded no clicks",
    postShort.totals.clicks === preShort.totals.clicks &&
      postShort.totals.unique === preShort.totals.unique,
    `${preShort.totals.clicks} -> ${postShort.totals.clicks}`,
  );

  const landing = await fetch(
    `${BASE}/l/start?ref=${encodeURIComponent(before.code)}`,
  );
  const landingHtml = await landing.text();
  check(
    "the landing page a short link points at renders",
    landing.status === 200 && landingHtml.includes("</html>"),
    `status=${landing.status}`,
  );

  // The referral cookie is set TWICE by design: once by the edge on the page
  // render, so attribution survives JavaScript being switched off, and once by
  // the click beacon. Both have to honour the preview flag — for a while only
  // the beacon did, so "preview sets no cookie" was quietly false in a browser.
  const edgeCookies = (landing.headers.getSetCookie?.() || []).join("; ");
  check(
    "the landing page sets the referral cookie",
    pick(edgeCookies, "ref") === before.code,
    pick(edgeCookies, "ref") || "missing",
  );

  const previewPage = await fetch(
    `${BASE}/l/start?ref=${encodeURIComponent(before.code)}&preview=1&c=test-tag`,
  );
  const previewCookies = (previewPage.headers.getSetCookie?.() || []).join(
    "; ",
  );
  check(
    "a preview page does not set the referral cookie",
    previewPage.status === 200 && !pick(previewCookies, "ref"),
    previewCookies ? "cookie leaked" : "no cookie",
  );
  check(
    "a preview page does not set the campaign cookie",
    !pick(previewCookies, "ref_c"),
    pick(previewCookies, "ref_c") || "no cookie",
  );
  const previewHtml = await previewPage.text();
  check(
    "a preview page is not offered to search engines",
    /noindex/.test(previewHtml),
  );

  // ── 5. the QR endpoint ───────────────────────────────────────────────────

  section("5. QR codes");

  const qr = await fetch(`${BASE}/api/partners/qr?slug=start&c=test-tag`, {
    headers: authHeaders,
  });
  const qrType = qr.headers.get("content-type") || "";
  const qrBody = await qr.text();
  check(
    "QR renders as SVG",
    qr.status === 200 && qrType.includes("image/svg+xml"),
    `${qr.status} ${qrType}`,
  );
  check("QR body is an SVG document", qrBody.trimStart().startsWith("<svg"));
  // The library draws the whole symbol as one long `d` attribute and the
  // backdrop as a second, tiny one, so the FIRST path says nothing at all —
  // it is the same 13-character rectangle for every QR ever generated. What
  // proves the code carries data is the length of the longest path.
  const paths = [...qrBody.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
  const longest = paths.reduce((n, p) => Math.max(n, p.length), 0);
  check(
    "QR actually encodes something",
    longest > 200,
    `longest path ${longest} chars, ${paths.length} path(s)`,
  );

  const qrAnon = await fetch(`${BASE}/api/partners/qr`);
  check(
    "QR requires a partner session",
    qrAnon.status === 401,
    `status=${qrAnon.status}`,
  );

  // The URL has to be built from the partner's own code server-side. If a caller
  // could pass one in, this would be a free QR generator wearing our domain.
  const qrSvg2 = await (
    await fetch(`${BASE}/api/partners/qr?slug=options&c=qr-probe`, {
      headers: authHeaders,
    })
  ).text();
  check(
    "QR honours the landing page it is asked for",
    qrSvg2.length > 200 && qrSvg2 !== qrBody,
    `${qrSvg2.length} vs ${qrBody.length} bytes`,
  );

  // ── 6. requests: panel -> console -> panel ───────────────────────────────

  section("6. A request reaches a person and the answer comes back");

  const madeRes = await fetch(BASE + "/api/partners/requests", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "landing_page",
      title: "verify-links probe",
      detail: "Automated check. Safe to decline.",
      audience: "crypto traders",
    }),
  });
  const made = await madeRes.json().catch(() => null);
  check(
    "a partner can file a request",
    madeRes.status === 200 && made?.ok === true,
    made?.error || `status=${madeRes.status}`,
  );

  const reqId = made?.id || "";
  const mineRes = await fetch(BASE + "/api/partners/requests", {
    headers: authHeaders,
  });
  const mine = await mineRes.json().catch(() => null);
  check(
    "the partner sees their own request",
    Array.isArray(mine?.requests) && mine.requests.some((r) => r.id === reqId),
  );
  check(
    "a new request starts open",
    (mine?.requests || []).find((r) => r.id === reqId)?.status === "open",
  );

  if (!admin) {
    console.log(
      `  skip  console checks — admin sign-in returned ${adminLogin.status}`,
    );
  } else {
    const adminHeaders = { cookie: `admin_token=${admin}` };

    const queueRes = await fetch(
      BASE + "/api/admin/affiliate-requests?status=open",
      { headers: adminHeaders },
    );
    const queue = await queueRes.json().catch(() => null);
    check(
      "the console lists it as open",
      (queue?.requests || []).some((r) => r.id === reqId),
      `openCount=${queue?.openCount}`,
    );

    // Declining without a reason must be refused: an answer of "no" that says
    // nothing is not an answer, and the partner reads the note verbatim.
    const noNote = await fetch(BASE + "/api/admin/affiliate-requests", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, status: "declined" }),
    });
    check(
      "declining without a reason is refused",
      noNote.status === 400,
      `status=${noNote.status}`,
    );

    const declined = await fetch(BASE + "/api/admin/affiliate-requests", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reqId,
        status: "declined",
        note: "Automated probe — no page needed.",
      }),
    });
    const decided = await declined.json().catch(() => null);
    check(
      "an operator can decline with a reason",
      declined.status === 200,
      decided?.error || `status=${declined.status}`,
    );

    const again = await fetch(BASE + "/api/admin/affiliate-requests", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, status: "done" }),
    });
    // A decided request is terminal; re-deciding would rewrite history.
    check(
      "a decided request cannot be re-decided",
      again.status === 409,
      `status=${again.status}`,
    );

    const backRes = await fetch(BASE + "/api/partners/requests", {
      headers: authHeaders,
    });
    const back = await backRes.json().catch(() => null);
    const mineNow = (back?.requests || []).find((r) => r.id === reqId);
    check(
      "the partner sees the decision",
      mineNow?.status === "declined",
      mineNow?.status,
    );
    check(
      "the reply note reaches the partner verbatim",
      (mineNow?.note || "").includes("Automated probe"),
      mineNow?.note || "",
    );
  }

  // ── 7. the panel pages themselves ────────────────────────────────────────

  section("7. The panel pages render for a signed-in partner");

  for (const path of ["/partners", "/partners/links", "/partners/earnings"]) {
    const r = await fetch(BASE + path, { headers: authHeaders });
    const html = await r.text();
    check(
      `${path} renders`,
      r.status === 200 && html.includes("</html>"),
      `status=${r.status}`,
    );
  }

  const anonLinks = await fetch(BASE + "/api/partners/links");
  check(
    "the links API is not readable without a session",
    anonLinks.status === 401,
    `status=${anonLinks.status}`,
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
  console.log("All partner link checks passed.");
}

process.exitCode = code;
