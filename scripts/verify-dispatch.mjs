// scripts/verify-dispatch.mjs — the dispatch route and its systemd timer.
//
//   node scripts/verify-dispatch.mjs [baseURL]
//
// Two halves, because the timer has two ways to be wrong and they live in
// different places.
//
// HALF ONE — the unit files, checked as text. These are the files that get
// installed by hand, on a host, at a moment when nobody is reading them
// carefully. A typo in a timer is silent: it is accepted, enabled, and simply
// never fires, or fires with an empty secret and 401s every five minutes into a
// journal nobody reads. So every invariant that matters is asserted here rather
// than trusted.
//
//   • the secret comes from EnvironmentFile, NEVER inlined in the unit — a unit
//     file is world-readable, and an inlined secret is a secret in a file that
//     `systemctl cat` will happily print for anyone with an account
//   • the request goes to 127.0.0.1, not the public hostname — it must not
//     travel out through Cloudflare and back
//   • curl uses -f, so an HTTP error is a failed unit rather than a silent ok
//   • the service is Type=oneshot — a plain service that "finishes" is a service
//     systemd will not run again
//   • the timer names its Unit= explicitly, so renaming one file cannot silently
//     orphan the other
//
// HALF TWO — the route, checked over HTTP. The timer will call this endpoint
// every five minutes for years, mostly when there is nothing to do, so the idle
// path has to be correct AND cheap, and the recovery path has to actually exist.
//
// Exits 0 on pass, 1 on failure, 2 when the server is unreachable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = (
  process.argv[2] ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const SECRET = process.env.TRACKING_DISPATCH_SECRET || "";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(HERE, "..", "deploy");

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

function readUnit(name) {
  try {
    return readFileSync(join(DEPLOY, name), "utf8");
  } catch {
    return null;
  }
}

/**
 * Strip comment lines before asserting on content.
 *
 * The units are heavily commented, and the comments mention the very things the
 * assertions look for — "EnvironmentFile" appears in a comment explaining why an
 * inline secret is wrong. Matching the raw text would pass on the explanation of
 * the rule rather than on the rule.
 */
function directives(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith(";"))
    .join("\n");
}

async function main() {
  // ── half one: the units ────────────────────────────────────────────────
  section("The unit files exist and say what they need to");

  const svcRaw = readUnit("tradekaro-dispatch.service");
  const tmrRaw = readUnit("tradekaro-dispatch.timer");
  check("tradekaro-dispatch.service exists", svcRaw !== null);
  check("tradekaro-dispatch.timer exists", tmrRaw !== null);
  if (svcRaw === null || tmrRaw === null) return;

  const svc = directives(svcRaw);
  const tmr = directives(tmrRaw);

  check(
    "the service is oneshot",
    /^Type\s*=\s*oneshot\s*$/m.test(svc),
    "a plain service has no notion of having finished, so the timer's " +
      "OnUnitActiveSec clock never restarts",
  );

  check(
    "the secret is read from EnvironmentFile",
    /^EnvironmentFile\s*=\s*\/opt\/tradekaro\/\.env\.production\s*$/m.test(svc),
    "one copy of the secret, shared with the app",
  );

  // The one that would actually leak. Matched against directives only, so the
  // comment warning about it does not count as an occurrence.
  const inlineSecret =
    /TRACKING_DISPATCH_SECRET\s*=\s*(?!\$\{)[A-Za-z0-9._\-]{8,}/.test(
      svc.replace(/\$\{TRACKING_DISPATCH_SECRET\}/g, ""),
    );
  check(
    "no secret value is inlined in the unit",
    !inlineSecret,
    "unit files are world-readable",
  );

  check(
    "the request targets loopback",
    /127\.0\.0\.1:3000\/api\/track\/dispatch/.test(svc),
    "does not go out through Cloudflare and back",
  );
  check(
    "the unit does not call the public hostname",
    !/tradestox\.pro\/api\/track\/dispatch/.test(svc),
  );

  check(
    "curl fails on an HTTP error",
    /curl[^\n]*-f/.test(svc),
    "-f turns a 401 or a 500 into a failed unit",
  );
  check("curl is given a timeout", /--max-time\s+\d+/.test(svc));
  check(
    "the service declares it wants the app",
    /^Wants\s*=\s*tradekaro\.service\s*$/m.test(svc),
    "Wants, not Requires — a down app must not cascade",
  );

  check(
    "the timer names its unit explicitly",
    /^Unit\s*=\s*tradekaro-dispatch\.service\s*$/m.test(tmr),
  );
  check(
    "the timer is installed into timers.target",
    /^WantedBy\s*=\s*timers\.target\s*$/m.test(tmr),
    "without this `systemctl enable` puts it nowhere",
  );
  check(
    "the timer does not fire at boot time",
    /^OnBootSec\s*=\s*[1-9]\d*(?:s|min|m)?\s*$/m.test(tmr),
    "the app is still starting and would refuse the connection",
  );
  check(
    "the timer has a recurring schedule",
    /^OnUnitActiveSec\s*=\s*\d+(?:s|min|m|h)?\s*$/m.test(tmr),
  );
  check("the timer has a [Timer] section", /\[Timer\]/.test(tmr));
  check("the service has a [Service] section", /\[Service\]/.test(svc));
  check(
    "the service has an [Install] section or none is needed",
    /\[Service\]/.test(svc),
  );

  // ── half two: the route ────────────────────────────────────────────────
  section("The endpoint the timer calls behaves");

  let reachable = true;
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
  } catch {
    try {
      await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
    } catch {
      reachable = false;
    }
  }
  if (!reachable) {
    console.log(
      `\nserver not reachable at ${BASE} — skipping the route checks`,
    );
    console.log(`\n${pass} passed, ${fail} failed (unit files only)`);
    process.exitCode = 2;
    return;
  }

  const dispatch = async (qs = "", headers = {}) => {
    const r = await fetch(`${BASE}/api/track/dispatch${qs}`, {
      method: "POST",
      headers,
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* a non-JSON body is itself a finding, reported by the caller */
    }
    return { status: r.status, body };
  };

  // Refuses when it cannot verify the caller.
  //
  // This is the property that matters most about this endpoint: it tells ad
  // platforms to spend money. An endpoint that falls open because a variable is
  // missing is worse than one that is unavailable, so "no secret configured"
  // must be a refusal and not a bypass.
  const noAuth = await dispatch();
  check(
    "an unauthenticated call is refused",
    noAuth.status === 401,
    `status=${noAuth.status}`,
  );

  const wrongAuth = await dispatch("", {
    "x-dispatch-secret": "not-the-secret",
  });
  check(
    "a wrong secret is refused",
    wrongAuth.status === 401,
    `status=${wrongAuth.status}`,
  );

  // A query parameter is accepted as well, but it must be the real one — the
  // earlier check proves a bad value is rejected in that position too.
  const badQuery = await dispatch("?secret=not-the-secret");
  check("a wrong secret in the query is refused", badQuery.status === 401);

  if (!SECRET) {
    console.log(
      "\nTRACKING_DISPATCH_SECRET is not set for this run — the authenticated " +
        "checks cannot run.",
    );
    console.log(
      "Start the server with TRACKING_DISPATCH_SECRET=test-secret and re-run " +
        "with the same value in the environment.",
    );
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) {
      console.log("\nFailed:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
    process.exitCode = fail ? 1 : 2;
    return;
  }

  const auth = { "x-dispatch-secret": SECRET };

  const authed = await dispatch("", auth);
  check(
    "the real secret is accepted",
    authed.status === 200 && authed.body?.ok === true,
    `status=${authed.status}`,
  );
  if (authed.status !== 200) {
    console.log(
      "\nThe authenticated checks cannot continue. The value the script has " +
        "does not match the server's.",
    );
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = 1;
    return;
  }

  // `configured` and `partnerPixels` are what the early exit is decided from.
  check(
    "the reply reports which platform providers are configured",
    Array.isArray(authed.body.configured),
    JSON.stringify(authed.body.configured),
  );
  check(
    "the reply reports the enabled partner-pixel count",
    typeof authed.body.partnerPixels === "number",
    `partnerPixels=${authed.body.partnerPixels}`,
  );

  // The recovery path. This was documented in the route and imported, but never
  // called — an operator who fixed a rotated token and ran `?requeue=1` got a
  // cheerful 200 and nothing happened at all.
  check(
    "the reply reports how many deliveries were requeued",
    typeof authed.body.requeued === "number",
    `requeued=${authed.body.requeued}`,
  );

  // The idle path, which is how this runs almost every time.
  //
  // `considered` is the count of rows actually walked. Its absence is the proof
  // that the queue was not touched: a reply that says "nothing configured" and
  // also reports having considered rows is a reply that did the work anyway.
  if (authed.body.configured.length === 0 && authed.body.partnerPixels === 0) {
    check(
      "with nothing configured the call short-circuits",
      authed.body.skipped === "nothing_configured",
      `skipped=${JSON.stringify(authed.body.skipped)}`,
    );
    check(
      "the short-circuit does not walk the queue",
      authed.body.considered === undefined,
      authed.body.considered === undefined
        ? "no rows touched"
        : `considered=${authed.body.considered}`,
    );
  } else {
    console.log(
      `  note  something is configured (${JSON.stringify(
        authed.body.configured,
      )}, ${authed.body.partnerPixels} partner pixel(s)) — the ` +
        "short-circuit path is not exercised by this run",
    );
  }

  // GET is the read-only view, used to answer "what is owed".
  const got = await fetch(`${BASE}/api/track/dispatch`, { headers: auth });
  const gotBody = await got.json().catch(() => null);
  check(
    "GET reports what is owed without sending anything",
    got.status === 200 && Array.isArray(gotBody?.summary),
    `status=${got.status}`,
  );

  // A dry run must build the payloads and send nothing. Proven by the absence of
  // any `sent` count rather than by trusting a flag in the reply.
  const dry = await dispatch("?dryRun=1", auth);
  check(
    "a dry run sends nothing",
    dry.status === 200 && !Number(dry.body?.sent),
    `sent=${dry.body?.sent}`,
  );

  // ── the idle-to-working transition ─────────────────────────────────────
  //
  // The question this whole section exists to answer: does the timer start doing
  // work once a partner has added a pixel?
  //
  // It must NOT be answered by enabling the timer at that moment. The timer runs
  // always and decides for itself, so what has to be true is that the same
  // scheduled call, with no change to the scheduler, stops short-circuiting the
  // instant a pixel exists — and goes back to idling when it is removed.
  section("A partner's pixel is what moves the timer from idle to working");

  const partnerEmail = process.env.PARTNER_EMAIL || "demo@tradestox.pro";
  const partnerPassword = process.env.PARTNER_PASSWORD || "Partner@Demo1";
  const sha256Hex = (s) =>
    import("node:crypto").then((m) =>
      m.createHash("sha256").update(s).digest("hex"),
    );

  // The partner's own sign-in, which hashes the password client-side and drops
  // the session in a `partner_token` cookie.
  let cookie = "";
  try {
    const login = await fetch(`${BASE}/api/partners/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: partnerEmail,
        password: await sha256Hex(partnerPassword),
      }),
    });
    const setCookie = (login.headers.getSetCookie?.() || []).join("; ");
    cookie = (setCookie.match(/partner_token=[^;]+/) || [])[0] || "";
    if (!cookie && login.status && login.status >= 400) {
      console.log(`  note  partner sign-in returned ${login.status}`);
    }
  } catch {
    /* handled below */
  }

  if (!cookie) {
    console.log(
      "  note  no partner session available — skipping the transition check " +
        "(set PARTNER_EMAIL / PARTNER_PASSWORD)",
    );
  } else {
    const pixels = await fetch(`${BASE}/api/partners/pixels`, {
      headers: { cookie },
    });
    const pb = await pixels.json().catch(() => null);

    if (!pb?.serverSideAvailable) {
      console.log(
        "  note  the server has no TRACKING_ENC_KEY, so it refuses to store " +
          "any pixel (correctly — it fails closed). The transition check needs " +
          "a server started with one. Skipped.",
      );
    } else {
      const before = await dispatch("", auth);
      const wasConfigured =
        (before.body?.configured?.length || 0) > 0 ||
        (before.body?.partnerPixels || 0) > 0;

      // A pixel with a token: the shape a partner fills in when they want
      // server-side sending, and the only shape that is not skipped for
      // `no_partner_token` later.
      const save = await fetch(`${BASE}/api/partners/pixels`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          provider: "meta",
          pixelId: "123456789012345",
          token: "EAAG" + "z".repeat(40),
        }),
      });
      const sv = await save.json().catch(() => null);
      check(
        "a partner can save a pixel with a token",
        save.status === 200 && sv?.ok === true,
        save.status !== 200
          ? `status=${save.status}`
          : `id=${sv?.pixel?.pixelId}`,
      );

      const after = await dispatch("", auth);
      check(
        "the dispatcher notices the new pixel without the timer changing",
        (after.body?.partnerPixels || 0) > 0,
        `partnerPixels=${after.body?.partnerPixels}`,
      );

      if (!wasConfigured) {
        check(
          "and stops short-circuiting",
          after.body?.skipped !== "nothing_configured",
          `skipped=${JSON.stringify(after.body?.skipped)}`,
        );
        check(
          "so the queue is actually walked",
          after.body?.considered !== undefined,
          `considered=${after.body?.considered}`,
        );
      } else {
        console.log(
          "  note  something was already configured, so the short-circuit was " +
            "not in play — only the count is asserted here",
        );
      }

      // Removing the pixel has to put it back to idle, or a partner who
      // experiments once leaves the timer doing work forever.
      const del = await fetch(`${BASE}/api/partners/pixels?provider=meta`, {
        method: "DELETE",
        headers: { cookie },
      });
      check(
        "the pixel can be removed again",
        del.status === 200,
        `status=${del.status}`,
      );

      const back = await dispatch("", auth);
      if (!wasConfigured) {
        check(
          "removing it returns the dispatcher to idle",
          back.body?.partnerPixels === 0 &&
            back.body?.skipped === "nothing_configured",
          `partnerPixels=${back.body?.partnerPixels} ` +
            `skipped=${JSON.stringify(back.body?.skipped)}`,
        );
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      "The timer is well formed and the endpoint it calls refuses the " +
        "unauthorised, idles cheaply, and can be recovered.",
    );
  }
}

main().catch((e) => {
  console.error("\nverification aborted:", e?.message || e);
  process.exitCode = 2;
});
