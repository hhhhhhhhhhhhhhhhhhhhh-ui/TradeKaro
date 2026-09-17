// Smoke tests for the market gateway + key pages.
// Usage: node scripts/smoke.mjs [baseURL]  (default http://localhost:3000)
const BASE = process.argv[2] || "http://localhost:3000";

const results = [];
let failed = 0;
let accountToken = "";

// Operator credentials for the gated admin checks. Read from the environment so
// this file does not publish a working console login to anyone reading the repo;
// the fallbacks are the local dev values, which only exist in .env.local.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Demo@123456";

async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* non-json */
  }
  return { status: r.status, json: j };
}

async function get(path) {
  const r = await fetch(BASE + path, { redirect: "manual" });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* html */
  }
  return { status: r.status, json: j };
}

async function check(name, fn) {
  try {
    const res = await fn();
    if (res.ok) {
      results.push(`PASS  ${name}  ${res.info || ""}`);
    } else {
      results.push(`FAIL  ${name}  ${res.info || ""}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL  ${name}  threw: ${e.message}`);
    failed++;
  }
}

await check("quote: mapped symbols (NIFTY, RELIANCE)", async () => {
  const r = await post("/api/market/quote", { symbols: ["NIFTY", "RELIANCE"] });
  const ok = r.status === 200 && r.json?.ticks?.length >= 1;
  return {
    ok,
    info: `status=${r.status} ticks=${r.json?.ticks?.length ?? 0} src=${r.json?.source}`,
  };
});

await check("quote: unmapped symbols resolve via master", async () => {
  const r = await post("/api/market/quote", {
    symbols: ["LODHA", "TECHM", "MOTHERSON", "TORNTPHARM"],
  });
  const ok = r.status === 200 && (r.json?.ticks?.length ?? 0) >= 3;
  return {
    ok,
    info: `status=${r.status} ticks=${r.json?.ticks?.length ?? 0} missing=${(r.json?.missing || []).join(",") || "-"}`,
  };
});

await check("quote: unknown symbol -> 404 no-data", async () => {
  const r = await post("/api/market/quote", { symbols: ["ZZZNOTREALX"] });
  const ok = r.status === 404;
  return { ok, info: `status=${r.status} err=${r.json?.error}` };
});

await check("candles: RELIANCE day", async () => {
  const r = await post("/api/market/candles", {
    symbol: "RELIANCE",
    interval: "day",
  });
  const ok = r.status === 200 && (r.json?.candles?.length ?? 0) > 20;
  return {
    ok,
    info: `status=${r.status} candles=${r.json?.candles?.length ?? 0}`,
  };
});

await check("candles: unmapped symbol (LODHA) 5m", async () => {
  const r = await post("/api/market/candles", {
    symbol: "LODHA",
    interval: "5m",
  });
  const ok = r.status === 200 && (r.json?.candles?.length ?? 0) > 5;
  return {
    ok,
    info: `status=${r.status} candles=${r.json?.candles?.length ?? 0}`,
  };
});

await check("fullquote: ltp + depth present", async () => {
  const r = await post("/api/market/fullquote", { symbol: "RELIANCE" });
  const q = r.json?.quote;
  const depth = (q?.depth?.buy?.length ?? 0) + (q?.depth?.sell?.length ?? 0);
  const ok = r.status === 200 && q?.ltp > 0 && depth > 0;
  return {
    ok,
    info: `status=${r.status} ltp=${q?.ltp} depthLevels=${depth} vwap=${q?.vwap}`,
  };
});

await check("optionchain: NIFTY expiries + rows", async () => {
  const r = await post("/api/market/optionchain", { underlying: "NIFTY" });
  const ok = r.status === 200 && (r.json?.rows?.length ?? 0) > 5;
  return {
    ok,
    info: `status=${r.status} rows=${r.json?.rows?.length ?? 0} expiry=${r.json?.expiry}`,
  };
});

await check("stats: provider health + instruments loaded", async () => {
  const r = await get("/api/market/stats");
  const ok =
    r.status === 200 &&
    r.json?.provider?.state !== undefined &&
    r.json?.instruments?.loaded === true &&
    r.json?.feed !== undefined;
  return {
    ok,
    info: `status=${r.status} provider=${r.json?.provider?.state} feedConnected=${r.json?.feed?.connected} eq=${r.json?.instruments?.eq}`,
  };
});

await check("stream: SSE hello + snapshot frame", async () => {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(BASE + "/api/market/stream?symbols=NIFTY", {
      signal: ac.signal,
    });
    const reader = r.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value || new Uint8Array());
    reader.cancel().catch(() => {});
    const ok = r.status === 200 && text.includes("event: hello");
    return {
      ok,
      info: `status=${r.status} first=${text.slice(0, 30).replace(/\n/g, "|")}`,
    };
  } finally {
    clearTimeout(to);
    ac.abort();
  }
});

await check("admin public config: paper rules present", async () => {
  const r = await get("/api/admin/public");
  const p = r.json?.trading;
  const ok =
    r.status === 200 &&
    p &&
    "brokerageFlat" in p &&
    "marginPct" in p &&
    "haltFills" in p &&
    typeof r.json?.kyc?.minDeposit === "number";
  return {
    ok,
    info: `status=${r.status} halt=${p?.haltFills} flat=${p?.brokerageFlat} margin=${p?.marginPct}% kycMin=${r.json?.kyc?.minDeposit}`,
  };
});

await check("trade sync route: rejects without token", async () => {
  const r = await post("/api/trade", { action: "load" });
  const ok = r.status === 401;
  return { ok, info: `status=${r.status}` };
});

let smokePhone = "";
let smokeEmail = "";

await check("account: register -> login -> token", async () => {
  const stamp = Date.now().toString(36);
  const uname = `smoke_${stamp}`;
  // 10 digits starting 9 — the shape the register route now requires.
  smokePhone = "9" + String(Date.now()).slice(-9);
  smokeEmail = `${uname}@test.local`;
  const reg = await post("/api/v1/auth/register", {
    username: uname,
    email: smokeEmail,
    password: "Smoke@1234",
    phone: smokePhone,
  });
  const log = await post("/api/v1/auth/login", {
    username: uname,
    password: "Smoke@1234",
  });
  const got = log.json?.token || "";
  if (got) accountToken = got;
  const ok =
    reg.status === 200 && log.status === 200 && String(got).length > 20;
  return {
    ok,
    info: `register=${reg.status} login=${log.status} tokenLen=${String(got).length}`,
  };
});

await check("account: login with mobile number", async () => {
  // Same account, identified by phone instead of username.
  const log = await post("/api/v1/auth/login", {
    username: smokePhone,
    password: "Smoke@1234",
  });
  const ok = log.status === 200 && String(log.json?.token || "").length > 20;
  return { ok, info: `phone=${smokePhone} status=${log.status}` };
});

await check("account: details + watchlist CRUD (local)", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const acc = await post("/api/v1/auth/getAccountDetails", {}, h);
  const add = await post(
    "/api/v1/transaction/addWatchlist",
    { scrip: "RELIANCE" },
    h,
  );
  const list = await post("/api/v1/getWatchList", {}, h);
  const hasRel = JSON.stringify(list.json || {}).includes("RELIANCE");
  const rm = await post(
    "/api/v1/transaction/removeWatchList",
    { scrip: "RELIANCE" },
    h,
  );
  const ok =
    acc.status === 200 &&
    (add.status === 200 || add.status === 409) &&
    list.status === 200 &&
    hasRel &&
    rm.status === 200;
  return {
    ok,
    info: `acc=${acc.status} add=${add.status} list=${hasRel ? "REL ok" : "missing"} rm=${rm.status}`,
  };
});

await check("account: buy -> details -> profit -> sell (local)", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const buy = await post(
    "/api/v1/transaction/buyScrip",
    { scrip: "RELIANCE", quantity: 2 },
    h,
  );
  const det = await post("/api/v1/auth/getAccountDetails", {}, h);
  const prof = await post("/api/v1/transaction/getAccountProfit", {}, h);
  const sell = await post(
    "/api/v1/transaction/sellScrip",
    { scrip: "RELIANCE", quantity: 2 },
    h,
  );
  const ok =
    buy.status === 200 &&
    det.status === 200 &&
    prof.status === 200 &&
    sell.status === 200;
  return {
    ok,
    info: `buy=${buy.status} details=${det.status} profit=${prof.status} sell=${sell.status}`,
  };
});

await check(
  "v1 extras: movers/indices/news/quote/orderbook (local)",
  async () => {
    const movers = await post("/api/v1/getTopMovers", { size: 5 });
    const idx = await post("/api/v1/getIndices", {});
    const news = await post("/api/v1/announcements", {});
    const q = await post("/api/v1/getStockQuote", {
      symbol: Buffer.from("RELIANCE").toString("base64"),
    });
    const ob = await post("/api/v1/getOrderBook", { symbol: "RELIANCE" });
    const ok =
      movers.status === 200 &&
      idx.status === 200 &&
      news.status === 200 &&
      q.status === 200 &&
      ob.status === 200;
    return {
      ok,
      info: `movers=${movers.status} idx=${idx.status} news=${news.status} quote=${q.status} book=${ob.status}`,
    };
  },
);

await check("pages: home + stock detail render", async () => {
  const a = await fetch(BASE + "/");
  const b = await fetch(BASE + "/stocks/RELIANCE");
  const ok = a.status === 200 && b.status === 200;
  return { ok, info: `home=${a.status} stock=${b.status}` };
});

// ── Connect account: User ID + connection token ────────────────────────────
// The token is minted server-side and only handed over once KYC is verified.
// These checks pin the refusal as much as the issuance — the refusal is the
// part that has to be true, and it must not depend on any admin action.

await check("connect: requires a signed-in account", async () => {
  const g = await fetch(BASE + "/api/account/connect");
  const p = await fetch(BASE + "/api/account/connect", { method: "POST" });
  const ok = g.status === 401 && p.status === 401;
  return { ok, info: `GET=${g.status} POST=${p.status}` };
});

let connectUserId = "";

await check("connect: status reports the user id and standing", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const r = await fetch(BASE + "/api/account/connect", { headers: h });
  const j = await r.json().catch(() => ({}));
  connectUserId = String(j?.userId || "");
  const ok =
    r.status === 200 &&
    connectUserId.length > 0 &&
    String(j?.clientID || "").length > 0 &&
    typeof j?.kyc === "string" &&
    typeof j?.unlocked === "boolean";
  return {
    ok,
    info: `status=${r.status} userId=${connectUserId.slice(0, 8)}… kyc=${j?.kyc} unlocked=${j?.unlocked}`,
  };
});

await check("connect: token is refused until KYC is verified", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const r = await fetch(BASE + "/api/account/connect", {
    method: "POST",
    headers: h,
  });
  const j = await r.json().catch(() => ({}));
  const ok =
    r.status === 403 &&
    j?.code === "kyc_required" &&
    String(j?.error || "")
      .toLowerCase()
      .includes("kyc") &&
    j?.token === undefined;
  return {
    ok,
    info: `status=${r.status} code=${j?.code} token=${j?.token === undefined ? "withheld" : "LEAKED"}`,
  };
});

await check("connect: 15-char token issued once KYC is verified", async () => {
  // Needs an operator to sign the KYC off, exactly as the real flow does.
  const login = await fetch(BASE + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = ((login.headers.getSetCookie?.() || [])
    .join("; ")
    .match(/admin_token=([^;]+)/) || [])[1];
  if (!cookie)
    return {
      ok: false,
      info: "skipped — could not sign in to the admin console",
    };

  const set = await fetch(BASE + "/api/admin/clients", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "admin_token=" + cookie,
    },
    body: JSON.stringify({ id: connectUserId, kyc: "VERIFIED" }),
  });

  const h = { Authorization: "Bearer " + accountToken };
  const a = await fetch(BASE + "/api/account/connect", {
    method: "POST",
    headers: h,
  });
  const first = await a.json().catch(() => ({}));
  const b = await fetch(BASE + "/api/account/connect", {
    method: "POST",
    headers: h,
  });
  const second = await b.json().catch(() => ({}));

  const raw = String(first?.token || "");
  const bare = raw.replace(/-/g, "");
  const ok =
    set.status === 200 &&
    a.status === 200 &&
    bare.length === 15 &&
    /^[A-Z0-9]+$/.test(bare) &&
    /[A-Z]/.test(bare) &&
    /[0-9]/.test(bare) &&
    // Stable across reveals — a credential, not a new value each time.
    raw === String(second?.token || "");
  return {
    ok,
    info: `kyc=${set.status} token=${raw} len=${bare.length} stable=${raw === second?.token}`,
  };
});

await check(
  "connect: an operator KYC verdict survives a heartbeat",
  async () => {
    // The client heartbeat reports whatever the legacy backend says, and that
    // stub always answers PENDING. It used to overwrite the operator's verdict,
    // so the token relocked itself on the user's next page load.
    const hb = await post("/api/client/heartbeat", {
      username: "smoke",
      email: smokeEmail,
      clientID: connectUserId,
      kyc: "PENDING",
    });
    const r = await fetch(BASE + "/api/account/connect", {
      headers: { Authorization: "Bearer " + accountToken },
    });
    const j = await r.json().catch(() => ({}));
    const ok =
      hb.status === 200 && hb.json?.kyc === "VERIFIED" && j?.kyc === "VERIFIED";
    return {
      ok,
      info: `heartbeatReports=${hb.json?.kyc} standing=${j?.kyc}`,
    };
  },
);

// ── Deposits & the KYC gate ───────────────────────────────────────────────
// A deposit must be recorded server-side, raise trading capital, and move the
// KYC gate. Each assertion is derived from the payload rather than hard-coded,
// so it holds whatever threshold the admin has configured.
let depositBaseline = null;

await check("deposit: unauthorised is refused", async () => {
  const r = await post("/api/trade/deposit", { amount: 1000 });
  const ok = r.status === 401;
  return { ok, info: `status=${r.status}` };
});

await check("deposit: rejected amounts do not credit", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const zero = await post("/api/trade/deposit", { amount: 0 }, h);
  const neg = await post("/api/trade/deposit", { amount: -5000 }, h);
  const huge = await post("/api/trade/deposit", { amount: 9_000_000 }, h);
  const ok = zero.status === 400 && neg.status === 400 && huge.status === 400;
  return {
    ok,
    info: `zero=${zero.status} negative=${neg.status} overCap=${huge.status}`,
  };
});

await check("deposit: credits ledger and raises capital", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const before = await post("/api/trade", { action: "load" }, h);
  const base = before.json?.account || {};
  depositBaseline = base;
  const dep = await post("/api/trade/deposit", { amount: 5000 }, h);
  const acct = dep.json?.account || {};
  const grew = (v) => (acct[v] ?? 0) - (base[v] ?? 0);
  const ok =
    dep.status === 200 &&
    Math.abs(Number(acct.deposited) - (Number(base.deposited) + 5000)) < 0.01 &&
    // The credit is real money: it shows up as trading capital too.
    Math.abs(grew("startCash") - 5000) < 0.01 &&
    Math.abs(grew("freeMargin") - 5000) < 0.01;
  return {
    ok,
    info: `deposited=${acct.deposited} capital+${grew("startCash").toFixed(2)} free+${grew("freeMargin").toFixed(2)}`,
  };
});

await check(
  "deposit: retrying the same idem is not credited twice",
  async () => {
    const h = { Authorization: "Bearer " + accountToken };
    const idem = "smoke-" + Date.now();
    const a = await post("/api/trade/deposit", { amount: 100, idem }, h);
    const b = await post("/api/trade/deposit", { amount: 100, idem }, h);
    const ok =
      a.status === 200 &&
      b.status === 200 &&
      b.json?.duplicate === true &&
      Math.abs(Number(a.json?.deposited) - Number(b.json?.deposited)) < 0.01;
    return {
      ok,
      info: `first=${a.json?.deposited} retry=${b.json?.deposited} duplicate=${b.json?.duplicate}`,
    };
  },
);

await check("kyc gate: eligibility follows the deposit rule", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const r = await post("/api/trade", { action: "load" }, h);
  const a = r.json?.account || {};
  const expected =
    Number(a.kycMinDeposit) <= 0 ||
    Number(a.deposited) >= Number(a.kycMinDeposit);
  const remaining = Math.max(0, Number(a.kycMinDeposit) - Number(a.deposited));
  const ok =
    r.status === 200 &&
    a.kycEligible === expected &&
    Math.abs(Number(a.kycRemaining) - remaining) < 0.01;
  return {
    ok,
    info: `deposited=${a.deposited} required=${a.kycMinDeposit} eligible=${a.kycEligible} left=${a.kycRemaining}`,
  };
});

await check("kyc gate: funding the requirement unlocks it", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const cur =
    (await post("/api/trade", { action: "load" }, h)).json?.account || {};
  const need =
    Math.ceil(Number(cur.kycMinDeposit) || 0) - Number(cur.deposited || 0);
  if (need <= 0) {
    // Gate already satisfied or switched off — nothing to prove here.
    return {
      ok: cur.kycEligible === true,
      info: `already eligible=${cur.kycEligible}`,
    };
  }
  // Top up in one go when the shortfall fits the single-deposit cap.
  const r = await post("/api/trade/deposit", { amount: need }, h);
  const a = r.json?.account || {};
  const ok =
    r.status === 200 && a.kycEligible === true && Number(a.kycRemaining) === 0;
  return {
    ok,
    info: `topped up ${need} -> eligible=${a.kycEligible} left=${a.kycRemaining}`,
  };
});

// ── MIS auto square-off ─────────────────────────────────────────────────────
// The risk sweep must fire at the CUTOFF rather than at the close, and it must
// work with no browser open — so this drives it purely through HTTP: open an
// intraday leg, move the cutoff into the past, and prove the next account read
// flattens it.
//
// Both settings are restored in `finally`. Leaving `allowAfterHours` on would
// silently disable the market-hours gate for every real user, so the restore is
// not optional housekeeping.
await check("mis: intraday leg is squared off server-side", async () => {
  const login = await fetch(BASE + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = ((login.headers.getSetCookie?.() || [])
    .join("; ")
    .match(/admin_token=([^;]+)/) || [])[1];
  if (!cookie) return { ok: false, info: "skipped — no admin session" };
  const adminHeaders = {
    "Content-Type": "application/json",
    Cookie: "admin_token=" + cookie,
  };

  const cfgRes = await fetch(BASE + "/api/admin/settings", {
    headers: { Cookie: "admin_token=" + cookie },
  });
  const original = (await cfgRes.json())?.settings?.trading;
  if (!original) return { ok: false, info: "could not read admin settings" };

  // The settings route takes the whole `trading` block, so every patch must
  // restate the two switches this check depends on — otherwise moving the cutoff
  // silently reverts `allowAfterHours` to the value snapshotted at the start and
  // the session gate then refuses the order. Only the cutoff varies per call.
  const putTrading = (patch) =>
    fetch(BASE + "/api/admin/settings", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        trading: {
          ...original,
          allowAfterHours: true,
          autoSquareOff: true,
          ...patch,
        },
      }),
    });

  const h = { Authorization: "Bearer " + accountToken };
  try {
    // Opening an intraday leg outside session hours needs the session switched
    // off. The cutoff stays normal here, so the order path is exercised before
    // the sweep is armed.
    const arm = await putTrading({
      allowAfterHours: true,
      autoSquareOff: true,
      squareOffTime: "15:15",
    });
    if (arm.status !== 200)
      return { ok: false, info: `could not arm settings (${arm.status})` };

    const sym = "SBIN";
    const q = await post("/api/market/quote", { symbols: [sym] });
    const ltp = q.json?.ticks?.find((t) => t.ltp)?.ltp;
    if (!ltp) return { ok: false, info: "no live price to open against" };

    const buy = await post(
      "/api/trade/order",
      {
        symbol: sym,
        kind: "STOCK",
        side: "BUY",
        qty: 1,
        price: ltp,
        product: "MIS",
        idem: `smoke-mis-${Date.now()}`,
      },
      h,
    );
    const leg = (buy.json?.account?.positions || []).find(
      (p) => p.scrip === sym && p.product === "MIS",
    );
    if (!leg)
      return {
        ok: false,
        info: `MIS open failed status=${buy.status} ${buy.json?.error || ""}`,
      };
    const filled = Number(buy.json?.account?.fills || 0);

    // Move the cutoff to a minute that has already passed today, then ask the
    // sweep to run. This is the operator's manual trigger; the automatic timer
    // is throttled to once a minute, which would make a timed test flaky.
    const moved = await putTrading({ squareOffTime: "00:01" });
    if (moved.status !== 200)
      return { ok: false, info: `could not move cutoff (${moved.status})` };

    const sweep = await fetch(BASE + "/api/admin/mis-sweep", {
      method: "POST",
      headers: { Cookie: "admin_token=" + cookie },
    }).then((r) => r.json());

    const after = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const stillOpen = (after?.positions || []).some(
      (p) => p.scrip === sym && p.product === "MIS",
    );
    // Fills must GROW past the opening fill — otherwise a leg that was never
    // opened at all would satisfy a naive `flat` assertion. `swept` is a global
    // count across every user, so it only has to be at least 1.
    const closedBySweep = Number(after?.fills || 0) === filled + 1;

    // ── reopen on the SAME symbol, and expect it to close again ──
    // This is the regression guard for the idempotency key. It used to be keyed
    // on the sweep timestamp, which outside session hours pins to the session
    // close — so the key repeated all evening and this second leg was silently
    // discarded by INSERT OR IGNORE and left open forever, while the sweep still
    // reported it as closed.
    const reopen = await post(
      "/api/trade/order",
      {
        symbol: sym,
        kind: "STOCK",
        side: "BUY",
        qty: 1,
        price: ltp,
        product: "MIS",
        idem: `smoke-mis2-${Date.now()}`,
      },
      h,
    );
    const reopened = (reopen.json?.account?.positions || []).some(
      (p) => p.scrip === sym && p.product === "MIS",
    );
    const sweep2 = await fetch(BASE + "/api/admin/mis-sweep", {
      method: "POST",
      headers: { Cookie: "admin_token=" + cookie },
    }).then((r) => r.json());
    const after2 = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const stillOpen2 = (after2?.positions || []).some(
      (p) => p.scrip === sym && p.product === "MIS",
    );

    // ── intraday + delivery on the SAME symbol ──
    // Positions are keyed by scrip alone and keep the product of whichever fill
    // opened them, so an MIS leg and a CNC leg on one name merge into a single
    // row. Opening the MIS leg FIRST is what made the sweep dangerous: the merged
    // row read as MIS, so squaring it off sold the delivery holding too. Only the
    // intraday quantity may be closed.
    const sym2 = "ITC";
    const q2 = await post("/api/market/quote", { symbols: [sym2] });
    const ltp2 = q2.json?.ticks?.find((t) => t.ltp)?.ltp;
    if (!ltp2) return { ok: false, info: "no live price for the mixed test" };

    await post(
      "/api/trade/order",
      {
        symbol: sym2,
        kind: "STOCK",
        side: "BUY",
        qty: 1,
        price: ltp2,
        product: "MIS",
        idem: `smoke-mix-mis-${Date.now()}`,
      },
      h,
    );
    const mixBuy = await post(
      "/api/trade/order",
      {
        symbol: sym2,
        kind: "STOCK",
        side: "BUY",
        qty: 1,
        price: ltp2,
        product: "CNC",
        idem: `smoke-mix-cnc-${Date.now()}`,
      },
      h,
    );
    const rowsFor = (acct) =>
      (acct?.positions || []).filter((p) => p.scrip === sym2);

    // Both buys must land as SEPARATE rows. Grouped by scrip alone they used to
    // merge into one row of 2 labelled after whichever leg opened first, which
    // sent the delivery unit to the intraday tab and charged it intraday margin.
    const heldRows = rowsFor(mixBuy.json?.account);
    const splitOk =
      heldRows.length === 2 &&
      heldRows.some((p) => p.product === "MIS" && Math.abs(p.qty) === 1) &&
      heldRows.some((p) => p.product === "CNC" && Math.abs(p.qty) === 1);
    const held = heldRows.reduce((a, p) => a + Math.abs(p.qty), 0);
    const sweep3 = await fetch(BASE + "/api/admin/mis-sweep", {
      method: "POST",
      headers: { Cookie: "admin_token=" + cookie },
    }).then((r) => r.json());
    const after3 = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    // Exactly the delivery row survives, still labelled CNC.
    const leftRows = rowsFor(after3);
    const keptDelivery =
      leftRows.length === 1 &&
      leftRows[0].product === "CNC" &&
      Math.abs(leftRows[0].qty) === 1;

    return {
      ok:
        Number(sweep?.swept || 0) >= 1 &&
        !stillOpen &&
        closedBySweep &&
        reopened &&
        Number(sweep2?.swept || 0) >= 1 &&
        !stillOpen2 &&
        splitOk &&
        held === 2 &&
        keptDelivery,
      info:
        `closed=${!stillOpen} reopened=${reopened} re-closed=${!stillOpen2} ` +
        `split=${splitOk ? "2 rows" : `BAD(${heldRows.length})`} ` +
        `after-sweep=${leftRows.map((p) => `${p.product}:${p.qty}`).join(",") || "none"} ` +
        `swept=${sweep?.swept}/${sweep2?.swept}/${sweep3?.swept}`,
    };
  } finally {
    // Restore, and surface it if the restore itself fails.
    const back = await putTrading({
      allowAfterHours: original.allowAfterHours === true,
      autoSquareOff: original.autoSquareOff !== false,
      squareOffTime: original.squareOffTime || "15:15",
    }).catch(() => ({ status: 0 }));
    if (back.status !== 200)
      console.log(`WARN  could not restore trading settings (${back.status})`);
  }
});

// ── console password rotation ───────────────────────────────────────────────
// The console credential is the one secret an operator cannot repair from the
// outside: ADMIN_PASSWORD is only read while the admin table is empty, so if
// this path breaks the only fix is hand-editing SQLite. That makes it worth a
// real test.
//
// It runs as a throwaway superadmin rather than the bootstrap account, so a
// half-finished run can never leave the real console password rotated to a
// value nobody knows. The throwaway is deleted in `finally`.
await check("adminpw: rotate own console password", async () => {
  const login = await fetch(BASE + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const cookie = ((login.headers.getSetCookie?.() || [])
    .join("; ")
    .match(/admin_token=([^;]+)/) || [])[1];
  if (!cookie) return { ok: false, info: "skipped — no admin session" };
  const adminHeaders = {
    "Content-Type": "application/json",
    Cookie: "admin_token=" + cookie,
  };

  const email = `smoke-pw-${Date.now()}@local`;
  const start = "SmokeStart123";
  const rotated = "SmokeRotated456";
  let madeId = "";
  try {
    const mk = await fetch(BASE + "/api/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email, password: start, role: "superadmin" }),
    }).then((r) => r.json());
    if (!mk?.ok)
      return {
        ok: false,
        info: `could not create test admin: ${mk?.error || "unknown"}`,
      };

    const list = await fetch(BASE + "/api/admin/users", {
      headers: { Cookie: "admin_token=" + cookie },
    }).then((r) => r.json());
    madeId = (list?.users || []).find((u) => u.email === email)?.id || "";
    if (!madeId) return { ok: false, info: "test admin has no id" };

    // Sign in as the throwaway so the rotation is aimed at its own account.
    const asNew = await fetch(BASE + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: start }),
    });
    const newCookie = ((asNew.headers.getSetCookie?.() || [])
      .join("; ")
      .match(/admin_token=([^;]+)/) || [])[1];
    if (!newCookie) return { ok: false, info: "throwaway login failed" };
    const asNewHeaders = {
      "Content-Type": "application/json",
      Cookie: "admin_token=" + newCookie,
    };

    const change = (body) =>
      fetch(BASE + "/api/admin/password", {
        method: "POST",
        headers: asNewHeaders,
        body: JSON.stringify(body),
      }).then((r) => r.status);

    const wrongCurrent = await change({ current: "nope", next: rotated });
    const tooShort = await change({ current: start, next: "short" });
    const sameAsOld = await change({ current: start, next: start });
    const good = await change({ current: start, next: rotated });

    // The real proof is not the 200 — it is that the old secret stops working
    // and the new one starts.
    const loginOld = await fetch(BASE + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: start }),
    }).then((r) => r.status);
    const loginNew = await fetch(BASE + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: rotated }),
    }).then((r) => r.status);

    // Non-mutating guard: the console must refuse to delete the account you are
    // signed in with.
    const selfDelete = await fetch(
      BASE + "/api/admin/users?id=" + encodeURIComponent(list?.users?.find((u) => u.email === ADMIN_EMAIL)?.id || ""),
      { method: "DELETE", headers: { Cookie: "admin_token=" + cookie } },
    ).then((r) => r.status);

    return {
      ok:
        wrongCurrent === 401 &&
        tooShort === 400 &&
        sameAsOld === 400 &&
        good === 200 &&
        loginOld === 401 &&
        loginNew === 200 &&
        selfDelete === 400,
      info:
        `bad-current=${wrongCurrent} short=${tooShort} same=${sameAsOld} ` +
        `change=${good} old-login=${loginOld} new-login=${loginNew} ` +
        `self-delete=${selfDelete}`,
    };
  } finally {
    if (madeId) {
      const del = await fetch(
        BASE + "/api/admin/users?id=" + encodeURIComponent(madeId),
        { method: "DELETE", headers: { Cookie: "admin_token=" + cookie } },
      ).catch(() => ({ status: 0 }));
      if (del.status !== 200)
        console.log(
          `WARN  could not delete smoke admin ${email} (${del.status}) — remove it by hand`,
        );
    }
  }
});

console.log("\n─── smoke results ───");
for (const line of results) console.log(line);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
