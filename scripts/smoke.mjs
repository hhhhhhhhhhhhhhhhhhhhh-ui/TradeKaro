// Smoke tests for the market gateway + key pages.
// Usage: node scripts/smoke.mjs [baseURL]  (default http://localhost:3000)
//
// SMOKE_ONLY=<substring> runs just the checks whose name contains it, which is
// handy against a live host where you want one answer and not a full database
// of test traffic.
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] || "http://localhost:3000";
const ONLY = process.env.SMOKE_ONLY || "";

const results = [];
let failed = 0;
let accountToken = "";

// Operator credentials for the gated admin checks. Read from the environment so
// this file does not publish a working console login to anyone reading the repo;
// the fallbacks are the local dev values, which only exist in .env.local.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Demo@123456";

// Indian markets are shut at weekends, and the provider's calendar is right to
// serve no sessions on those days. Checks that need a LIVE session must not
// report a failure when the market is simply closed: a weekend red is noise,
// and noise is how a real regression gets ignored. These report SKIPPED.
function isWeekend(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** True when the calendar legitimately has nothing to run today. */
function marketClosed(cal) {
  return (
    !!cal && isWeekend(cal.date) && Object.keys(cal.sessions || {}).length === 0
  );
}

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

async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { redirect: "manual", headers });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* html */
  }
  return { status: r.status, json: j };
}

async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
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

// ── operator session, for the checks that need a credit ─────────────────────
//
// Money can only enter an account two ways now: a verified gateway callback or
// an operator credit. A test cannot forge a callback end to end (it has no
// settled payment), so the funding path here is the OPERATOR one — which is
// also the path a human actually uses, making it the better thing to exercise.
// Against a host whose console password is not the local default, these checks
// report a skip rather than failing, the same as the other admin-gated ones.
let adminCookie = "";
async function adminSession() {
  if (adminCookie) return adminCookie;
  const r = await fetch(BASE + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  adminCookie =
    ((r.headers.getSetCookie?.() || [])
      .join("; ")
      .match(/admin_token=([^;]+)/) || [])[1] || "";
  return adminCookie;
}

/** Credit an account the way an operator does. Returns null when it cannot. */
async function creditViaAdmin(userId, amount, note) {
  const cookie = await adminSession();
  if (!cookie) return null;
  const r = await post(
    "/api/admin/clients",
    { id: userId, deposit: amount, depositNote: note || "smoke" },
    { Cookie: "admin_token=" + cookie },
  );
  return r.status === 200 ? r.json : null;
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
// Money enters an account exactly two ways now — a verified gateway callback or
// an operator credit — and NEITHER is reachable by a customer. These checks pin
// that down, then prove a real credit still moves the KYC gate and the wallet.
let depositBaseline = null;

await check("deposit: unauthorised is refused", async () => {
  const r = await post("/api/trade/deposit", { amount: 1000 });
  const ok = r.status === 401;
  return { ok, info: `status=${r.status}` };
});

await check("deposit: a signed-in user cannot credit themselves", async () => {
  // ⚠️ The check that matters most in this file. This route used to credit the
  // ledger directly, so any signed-in user could add ₹5,00,000 per request, clear
  // the KYC threshold in one click and then ask for a real withdrawal. It must
  // now refuse — and refuse WITHOUT moving the balance, which is what the second
  // half of this assertion is for.
  const h = { Authorization: "Bearer " + accountToken };
  const before = (await post("/api/trade", { action: "load" }, h)).json
    ?.account;
  const zero = await post("/api/trade/deposit", { amount: 0 }, h);
  const big = await post("/api/trade/deposit", { amount: 9_000_000 }, h);
  const after = (await post("/api/trade", { action: "load" }, h)).json?.account;
  const moved =
    Math.abs(Number(after?.deposited) - Number(before?.deposited)) > 0.001 ||
    Math.abs(Number(after?.withdrawable) - Number(before?.withdrawable)) >
      0.001;
  const refused = zero.status === 410 && big.status === 410;
  return {
    ok: refused && !moved,
    info: refused
      ? moved
        ? "refused but the balance moved"
        : `refused with 410, balance unchanged (${before?.deposited})`
      : `zero=${zero.status} large=${big.status}`,
  };
});

await check(
  "deposit: an operator credit raises capital and the wallet",
  async () => {
    const h = { Authorization: "Bearer " + accountToken };
    const me = await post("/api/v1/auth/getAccountDetails", {}, h);
    const userId = String(me.json?.clientID || "").replace(/^u-/, "");
    if (!userId) return { ok: false, info: "no account id" };

    const before = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const credited = await creditViaAdmin(userId, 5000, "smoke credit");
    if (!credited)
      return { ok: false, info: "skipped — could not sign in to the console" };
    depositBaseline = before;

    const after = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const grew = (v) => (after?.[v] ?? 0) - (before?.[v] ?? 0);
    const ok =
      Math.abs(grew("deposited") - 5000) < 0.01 &&
      // Real money in is a wallet balance, and it also buys trading room.
      Math.abs(grew("withdrawable") - 5000) < 0.01 &&
      Math.abs(grew("startCash") - 5000) < 0.01;
    return {
      ok,
      info: `deposited+${grew("deposited").toFixed(0)} withdrawable+${grew("withdrawable").toFixed(0)} capital+${grew("startCash").toFixed(0)}`,
    };
  },
);

await check("wallet: the page's numbers come from the ledger", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const w = (await get("/api/wallet", h)).json || {};
  const a =
    (await post("/api/trade", { action: "load" }, h)).json?.account || {};
  // Two endpoints, one truth. A wallet that disagrees with the account payload
  // is the mismatch that makes a money screen untrustworthy.
  const ok =
    Math.abs(Number(w.walletBalance) - Number(a.walletBalance)) < 0.01 &&
    Math.abs(Number(w.withdrawable) - Number(a.withdrawable)) < 0.01 &&
    Math.abs(Number(w.deposited) - Number(a.walletDeposited)) < 0.01;
  return {
    ok,
    info: `wallet=${w.walletBalance} account=${a.walletBalance} available=${w.withdrawable}`,
  };
});

await check("wallet: practice credits are not withdrawable", async () => {
  // The hole this closes: money that was never paid in must not be payable out.
  // `deposited` on the wallet payload is the REAL total (gateway + operator);
  // practice credits are reported separately and are not spendable.
  const h = { Authorization: "Bearer " + accountToken };
  const w = (await get("/api/wallet", h)).json || {};
  const practice = Number(w.practiceCredit) || 0;
  const wallet = Number(w.deposited) || 0;
  const available = Number(w.withdrawable) || 0;
  const ok = available <= wallet + 0.01;
  return {
    ok,
    info: ok
      ? `practice=${practice} realDeposits=${wallet} withdrawable=${available}`
      : `withdrawable ${available} exceeds real money in (${wallet})`,
  };
});

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

await check("kyc gate: a real credit unlocks it", async () => {
  // Every credit counts toward the requirement, whoever made it — a gateway
  // payment or an operator top-up. That is why this drives the OPERATOR path:
  // it is the one a test can actually perform, and the one a human uses.
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
  const me = await post("/api/v1/auth/getAccountDetails", {}, h);
  const userId = String(me.json?.clientID || "").replace(/^u-/, "");
  if (!userId) return { ok: false, info: "no account id" };
  const credited = await creditViaAdmin(userId, need, "smoke KYC top-up");
  if (!credited)
    return { ok: false, info: "skipped — could not sign in to the console" };
  const a =
    (await post("/api/trade", { action: "load" }, h)).json?.account || {};
  const ok =
    a.kycEligible === true &&
    Number(a.kycRemaining) === 0 &&
    Number(a.withdrawable) > 0;
  return {
    ok,
    info: `credited ${need} -> eligible=${a.kycEligible} left=${a.kycRemaining} withdrawable=${a.withdrawable}`,
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
  // The sweep needs a session cutoff to miss. On a closed market there is
  // nothing to assert, so say so instead of reporting a failure nobody can act on.
  const pub = await get("/api/admin/public");
  if (marketClosed(pub.json?.calendar))
    return { ok: true, info: "SKIPPED — market closed today" };

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
  // Never a constant. This account is briefly a real superadmin on whichever
  // host the suite runs against, so a guessable password is a live risk.
  const start = "Sm" + randomUUID().replace(/-/g, "");
  const rotated = "Sm" + randomUUID().replace(/-/g, "");
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
      BASE +
        "/api/admin/users?id=" +
        encodeURIComponent(
          list?.users?.find((u) => u.email === ADMIN_EMAIL)?.id || "",
        ),
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

// ── client codes ────────────────────────────────────────────────────────────
// The broker-style display ID a customer reads off their profile (TK267X9Q4).
// Two things must hold: it never leaks the raw primary key, and no two accounts
// share one — a customer quotes this to support, so an ambiguous code is a real
// support problem rather than a cosmetic one.
await check("account: client code is well-formed and unique", async () => {
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const uname = `code_${Date.now().toString(36)}_${i}`;
    const reg = await post("/api/v1/auth/register", {
      username: uname,
      email: `${uname}@test.local`,
      password: "Code@12345",
      phone: "9" + String(Date.now() + i).slice(-9),
    });
    if (reg.status !== 200)
      return {
        ok: false,
        info: `register=${reg.status} ${reg.json?.error || ""}`,
      };
    const log = await post("/api/v1/auth/login", {
      username: uname,
      password: "Code@12345",
    });
    const code = String(log.json?.clientCode || "");
    codes.push(code);

    // The profile page renders this field, not the login response, so a code
    // that only exists on login would look like it had vanished on refresh.
    const token = String(log.json?.token || "");
    const acct = await post(
      "/api/v1/auth/getAccountDetails",
      {},
      { Authorization: "Bearer " + token },
    );
    if (String(acct.json?.clientCode || "") !== code) {
      return {
        ok: false,
        info: `profile API returned "${acct.json?.clientCode}" for code "${code}"`,
      };
    }
  }

  const WELL_FORMED = /^TK\d{2}[23456789A-HJ-NP-Z]{5}$/;
  const shaped = codes.filter((c) => WELL_FORMED.test(c)).length;
  const distinct = new Set(codes).size;
  // A 16-char hex string here means the raw primary key is still being shown,
  // which is the whole thing this replaced.
  const leakedKey = codes.some((c) => /^[0-9a-f]{16}$/.test(c));

  return {
    ok: shaped === 3 && distinct === 3 && !leakedKey,
    info: leakedKey
      ? `raw key still exposed: ${codes.join(",")}`
      : `codes=${codes.join(",")}${
          shaped === 3 && distinct === 3 ? "" : " (shape/dup problem)"
        }`,
  };
});

// ── exchange calendar ───────────────────────────────────────────────────────
// The gate reads real per-exchange sessions now, so the shape of what the
// provider returns is load-bearing. Two things must hold: every segment we
// trade resolves to a session, and the segments genuinely differ — NFO closes
// ten minutes after NSE cash, and MCX runs into the evening. If those ever come
// back equal, the calendar has silently degraded to the old single window and
// the tail of every options session is being refused again.
const istHM = (ms) =>
  new Date(Number(ms) + 5.5 * 3600_000).toISOString().slice(11, 16);

await check("market: calendar serves per-segment sessions", async () => {
  const r = await get("/api/admin/public");
  const cal = r.json?.calendar;
  // A null calendar is legal (provider unreachable) — the gate then falls back
  // to the admin window. It is only a failure if the provider is up and we are
  // still not getting sessions.
  if (!cal) return { ok: false, info: "no calendar in the public config" };

  const s = cal.sessions || {};
  // A closed market has no sessions by definition. Failing here would blame the
  // platform for the exchange being shut.
  if (marketClosed(cal))
    return { ok: true, info: `${cal.date} is a weekend — no session expected` };

  const missing = ["NSE", "NFO", "MCX"].filter((e) => !s[e]);
  if (missing.length)
    return { ok: false, info: `no session for ${missing.join(", ")}` };

  const nfoLater = Number(s.NFO.end) > Number(s.NSE.end);
  const mcxLater = Number(s.MCX.end) > Number(s.NSE.end);
  const holidays = (r.json?.holidays || []).length;

  return {
    ok: nfoLater && mcxLater && !cal.closed.includes("NSE"),
    info:
      `NSE ${istHM(s.NSE.end)} · NFO ${istHM(s.NFO.end)} · ` +
      `MCX ${istHM(s.MCX.end)} · ${holidays} holidays · ` +
      `closed today=[${(cal.closed || []).join(",")}]`,
  };
});

// ── commodity roots and lot sizes ───────────────────────────────────────────
// A commodity root must resolve to ITS OWN contract, with a lot size that
// matches what the exchange actually prices. Both were wrong in ways that only
// showed up as money, so the expectations are pinned:
//
//   * the master's `name` column groups variants, so GOLD resolved to GOLDPETAL
//     (one gram, ~1/100th the price) and SILVER to SILVER100;
//   * SILVER is also an NSE ETF ticker, and equity-first lookup returned the ETF
//     against a commodity's lot size;
//   * MCX's gold family reports a lot size that is neither the quoted unit nor
//     the contract weight, so GOLD and GOLDM are stated explicitly;
//   * and the three base metals report their weight in TONNES — ZINC, LEAD and
//     ALUMINIUM all said `5`, which was read as five quoted units. A five-tonne
//     contract came out at about ₹2,156, cheaper than a single gram of gold
//     petal, while COPPER beside it sat at ₹34.98 L.
//
// Anything here failing means real exposure is being mispriced, not just a label.
const COMMODITY_EXPECT = {
  GOLD: { segment: "MCX", lot: 100 },
  GOLDM: { segment: "MCX", lot: 10 },
  GOLDPETAL: { segment: "MCX", lot: 1 },
  SILVER: { segment: "MCX", lot: 30 },
  CRUDEOIL: { segment: "MCX", lot: 100 },
  COPPER: { segment: "MCX", lot: 2500 },
  ZINC: { segment: "MCX", lot: 5000 },
  LEAD: { segment: "MCX", lot: 5000 },
  ALUMINIUM: { segment: "MCX", lot: 5000 },
  ALUMINI: { segment: "MCX", lot: 1000 },
};

await check(
  "market: commodity roots resolve to their own contracts",
  async () => {
    const r = await get(
      "/api/market/instrument?symbols=" +
        [...Object.keys(COMMODITY_EXPECT), "RELIANCE"].join(","),
    );
    if (r.status !== 200)
      return { ok: false, info: `status=${r.status} ${r.json?.error || ""}` };

    const items = r.json?.items || [];
    const by = Object.fromEntries(items.map((i) => [i.symbol, i]));
    const bad = [];
    const seen = [];

    for (const [sym, want] of Object.entries(COMMODITY_EXPECT)) {
      const it = by[sym];
      if (!it) {
        bad.push(`${sym}:missing`);
        continue;
      }
      const lot = Number(it.contract?.lot);
      seen.push(`${sym} ${it.segment}/${lot}`);
      if (!it.key) bad.push(`${sym}:no-key`);
      else if (it.segment !== want.segment)
        bad.push(`${sym}:segment=${it.segment}!=${want.segment}`);
      else if (!it.isCommodity) bad.push(`${sym}:not-commodity`);
      else if (lot !== want.lot) bad.push(`${sym}:lot=${lot}!=${want.lot}`);
    }

    // GOLD and GOLDPETAL are different contracts; sharing a key is the exact
    // symptom of falling back to the `name` column.
    if (by.GOLD?.key && by.GOLD.key === by.GOLDPETAL?.key)
      bad.push("GOLD and GOLDPETAL share a key");
    // An equity must not inherit a commodity contract.
    if (by.RELIANCE?.contract) bad.push("RELIANCE has a commodity contract");

    return {
      ok: !bad.length,
      info: bad.length ? bad.join(" ") : seen.join(" · "),
    };
  },
);

// ── commodity contracts carry a usable lot, tick and expiry ─────────────────
// Lot sizes are asserted above; this covers the fields the UI consumes. The tick
// in particular is what the ticket's price stepper uses — a zero or a missing
// tick falls back to a 5-paise step, which lets a customer pick a price the
// exchange does not have, on the contract where the error is largest.
await check(
  "market: commodity contracts carry lot, tick and expiry",
  async () => {
    const r = await get(
      "/api/market/instrument?symbols=GOLD,SILVER,CRUDEOIL,COPPER,ZINC",
    );
    const items = r.json?.items || [];
    const bad = [];
    const seen = [];
    for (const i of items) {
      const lot = Number(i.contract?.lot);
      const tick = Number(i.contract?.tick);
      const exp = String(i.contract?.expiry || "");
      if (!(lot > 0)) bad.push(`${i.symbol}:lot=${i.contract?.lot}`);
      if (!(tick > 0)) bad.push(`${i.symbol}:tick=${i.contract?.tick}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp))
        bad.push(`${i.symbol}:expiry=${exp || "none"}`);
      if (lot > 0 && tick > 0) seen.push(`${i.symbol} lot${lot}/tick${tick}`);
    }
    if (items.length < 5) bad.push(`only ${items.length} of 5 resolved`);
    return {
      ok: !bad.length,
      info: bad.length ? bad.join(" ") : seen.join(" · "),
    };
  },
);

// ── the tick is served in rupees, not the master's paise ────────────────────
// `tick_size` in the master is paise: gold 100, zinc 5, cotton 1000. Every
// consumer of `contract.tick` is a rupee price input — the ticket's limit
// stepper and the alert box — so serving it raw made gold step ₹100 at a time on
// a contract whose real tick is ₹1, and the alert box could never reach the price
// it was set against. The conversion is one line in the instrument route and
// trivial to revert by accident, hence a check pinned to three published MCX
// specs rather than merely "tick > 0".
await check("market: commodity tick is in rupees, not paise", async () => {
  const want = { GOLD: 1, ZINC: 0.05, COTTON: 10 };
  const r = await get(
    `/api/market/instrument?symbols=${Object.keys(want).join(",")}`,
  );
  const items = r.json?.items || [];
  const bad = [];
  const seen = [];
  for (const [sym, expect] of Object.entries(want)) {
    const got = Number(items.find((i) => i.symbol === sym)?.contract?.tick);
    if (!Number.isFinite(got)) bad.push(`${sym}:missing`);
    else if (Math.abs(got - expect) > 1e-9)
      bad.push(
        `${sym}:tick=${got} want ${expect}${got >= expect * 10 ? " (paise?)" : ""}`,
      );
    else seen.push(`${sym} ₹${got}`);
  }
  return {
    ok: !bad.length,
    info: bad.length ? bad.join(" ") : seen.join(" · "),
  };
});

// ── commodities reach the market-survey surfaces ────────────────────────────
// The mover universe is a hardcoded equity table, which is exactly the shape of
// thing that left commodities out of every survey surface. The commodity group
// is computed from the instrument master instead.
await check("market: commodities appear in movers", async () => {
  const r = await post("/api/v1/topmovers", { size: 6 });
  const items = r.json?.TOP_COMMODITIES?.items || [];
  const priced = items.filter((i) => Number(i.ltp) > 0);
  if (!priced.length)
    return {
      ok: false,
      info: `no priced commodity movers (status ${r.status})`,
    };
  // Ranked by ABSOLUTE change, so one list carries both directions.
  const sorted = priced.every(
    (i, n) =>
      n === 0 ||
      Math.abs(Number(priced[n - 1].dayChangePerc)) >=
        Math.abs(Number(i.dayChangePerc)) - 1e-9,
  );
  return {
    ok: sorted,
    info: sorted
      ? `${priced.length} contracts · top ${priced[0].symbol} ${Number(
          priced[0].dayChangePerc,
        ).toFixed(2)}%`
      : "not ranked by absolute change",
  };
});

// ── news ────────────────────────────────────────────────────────────────────
// Two parsing traps live here and both fail quietly: the payload is keyed by
// instrument rather than being a list (reading it as one yields an empty feed
// that looks exactly like a quiet news day), and `published_time` is a NUMBER,
// on which Date.parse returns NaN — which silently strips every date and makes
// the feed unsortable.
await check(
  "news: feed serves articles, each with a parseable date",
  async () => {
    const r = await get("/api/v1/announcements");
    const a = r.json?.articles || [];
    if (!a.length)
      return {
        ok: false,
        info: `source=${r.json?.source} reason=${String(r.json?.reason || "").slice(0, 120)}`,
      };
    const undated = a.filter(
      (x) => !x.date || Number.isNaN(Date.parse(x.date)),
    );
    const unlinked = a.filter((x) => !x.url);
    return {
      ok: !undated.length && !unlinked.length,
      info: undated.length
        ? `${undated.length}/${a.length} articles lost their date`
        : unlinked.length
          ? `${unlinked.length}/${a.length} articles have no link`
          : `${a.length} articles, all dated and linked`,
    };
  },
);

// ── instrument master health ────────────────────────────────────────────────
// Warm it first. /api/market/stats reports `loaded:false` until a load has been
// triggered in that bundle, which is benign — asserting on a cold bundle would
// be a false alarm, which is the trap this check exists to avoid repeating.
await check("market: instrument master carries commodities", async () => {
  await post("/api/market/quote", { symbols: ["GOLD", "NIFTY"] });
  const r = await get("/api/market/stats");
  const m = r.json?.instruments || {};
  const eq = Number(m.eq || 0);
  const idx = Number(m.idx || 0);
  const com = Number(m.com || 0);
  return {
    ok: eq > 1000 && idx > 50 && com > 10,
    info: `eq=${eq} idx=${idx} com=${com} loaded=${m.loaded}${m.error ? ` error=${String(m.error).slice(0, 80)}` : ""}`,
  };
});

// ── anonymous route protection ──────────────────────────────────────────────
// A private page must bounce a visitor to /login, not render an account-shaped
// shell full of zeros. This is also the only thing keeping the proxy's
// `matcher` and its PROTECTED list in step: a path listed in PROTECTED but
// missing from the matcher never reaches the redirect logic at all, so without
// this check it would silently stay public.
await check("auth: private pages redirect visitors to /login", async () => {
  const PRIVATE = [
    "/dashboard",
    "/portfolio",
    "/portfolio/orders",
    "/positions",
    "/ledger",
    "/watchlist",
    "/profile",
    "/profile/security",
    "/profile/kyc",
    "/profile/banks",
    "/settings",
    "/connect",
  ];
  // The shop window. Locking any of these would hide the product from
  // visitors and from search engines, so they are asserted to stay open.
  const PUBLIC = [
    "/",
    "/stocks",
    "/options",
    "/screener",
    "/topmovers",
    "/commodities",
    "/news",
    "/login",
    "/signup",
    "/terms",
  ];

  const probe = async (p) => {
    const r = await fetch(BASE + p, { redirect: "manual" });
    return {
      status: r.status,
      to: r.headers.get("location") || "",
      cache: r.headers.get("cache-control") || "",
    };
  };

  const leaks = [];
  for (const p of PRIVATE) {
    const r = await probe(p);
    const bounced =
      r.status >= 300 && r.status < 400 && r.to.includes("/login");
    // The destination must travel with the redirect, or a visitor who signs in
    // lands on the dashboard instead of the page they asked for.
    if (!bounced || !r.to.includes("next="))
      leaks.push(`${p}->${r.status}${r.to ? `:${r.to}` : ""}`);
    // A cacheable bounce gets replayed after sign-in and strands the user on
    // the login page holding a perfectly valid cookie — which reads as "the
    // sign-in button does nothing".
    else if (!r.cache.includes("no-store"))
      leaks.push(`${p} bounce cacheable (${r.cache || "no cache-control"})`);
  }

  const broken = [];
  for (const p of PUBLIC) {
    const r = await probe(p);
    if (r.status !== 200) broken.push(`${p}->${r.status}`);
  }

  return {
    ok: !leaks.length && !broken.length,
    info: leaks.length
      ? `NOT PROTECTED: ${leaks.join(", ")}`
      : broken.length
        ? `public page not 200: ${broken.join(", ")}`
        : `${PRIVATE.length} private bounced, ${PUBLIC.length} public open`,
  };
});

// ── a fresh session can actually open a protected page ───────────────────────
// The reported symptom was "it says signed in but never leaves the sign-in
// page". The server half of that is the gate refusing a token it just issued —
// a signing-secret mismatch, or a session cookie the proxy will not accept.
// Both are invisible to the checks above, which only ever assert that signed-OUT
// requests are refused.
await check("auth: a signed-in session opens a protected page", async () => {
  const stamp = Date.now().toString(36);
  const uname = `sess_${stamp}`;
  const reg = await post("/api/v1/auth/register", {
    username: uname,
    email: `${uname}@test.local`,
    password: "Session@1234",
    phone: "9" + String(Date.now()).slice(-9),
  });
  if (reg.status !== 200) return { ok: false, info: `register=${reg.status}` };

  const log = await fetch(BASE + "/api/v1/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: uname, password: "Session@1234" }),
  });
  const setCookies = log.headers.getSetCookie?.() || [];
  const cookie = (setCookies.join("; ").match(/token=([^;]+)/) || [])[1] || "";
  if (!cookie) return { ok: false, info: "login issued no token cookie" };

  // Every page the client may redirect to straight after signing in.
  const targets = ["/dashboard", "/portfolio", "/positions", "/watchlist"];
  const refused = [];
  for (const t of targets) {
    const r = await fetch(BASE + t, {
      headers: { Cookie: "token=" + cookie },
      redirect: "manual",
    });
    if (r.status !== 200) refused.push(`${t}->${r.status}`);
  }

  // And the login page must actively push a signed-in visitor onwards instead
  // of showing them the form again.
  const loginPage = await fetch(BASE + "/login", {
    headers: { Cookie: "token=" + cookie },
    redirect: "manual",
  });
  const pushedOn =
    loginPage.status >= 300 &&
    loginPage.status < 400 &&
    (loginPage.headers.get("location") || "").includes("/dashboard");

  return {
    ok: !refused.length && pushedOn,
    info: refused.length
      ? `token rejected for: ${refused.join(", ")}`
      : pushedOn
        ? `${targets.length} pages opened, /login redirects to /dashboard`
        : `signed-in /login did not redirect (${loginPage.status})`,
  };
});

// ── payment gateway ─────────────────────────────────────────────────────────
// ⚠️ This suite must never turn the payment rail on, and must never write a test
// key into the settings row: secrets can be replaced through the console but not
// blanked, so a test key would permanently overwrite a real one with no way back.
// So these checks assert only the invariants that hold WITHOUT credentials — and
// those are the ones that matter most, because each of them is a way real money
// could move when it should not.

await check("payments: a forged callback is refused outright", async () => {
  // A payload that asks for a very large successful payment, signed with
  // nonsense. If this can ever return 200, an unauthenticated stranger can
  // declare their own top-up settled.
  const forged = JSON.stringify({
    event: "payin.updated",
    id: "txn_forged",
    order_id: "TK-FORGED",
    status: "success",
    amount: 999999,
  });
  const tried = [];
  for (const path of [
    "/api/payments/webhook/payin",
    "/api/payments/webhook/payout",
  ]) {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": "deadbeef",
      },
      body: forged,
    });
    tried.push({ path, status: r.status });
  }
  // 401 when the rail is configured (signature rejected), 503 when it is not.
  // Both are refusals. A 200 means forged money, a 500 means the handler threw
  // instead of checking.
  const bad = tried.filter((t) => t.status !== 401 && t.status !== 503);
  return {
    ok: !bad.length,
    info: bad.length
      ? bad.map((b) => `${b.path}->${b.status}`).join(" ")
      : tried.map((t) => `${t.path.split("/").pop()}=${t.status}`).join(" · "),
  };
});

await check("payments: a top-up needs a session", async () => {
  // Without a session, categorically refused.
  const anon = await post("/api/payments/payin", { amount: 100 });
  if (anon.status !== 401)
    return { ok: false, info: `no-session top-up returned ${anon.status}` };

  // With a session but the rail off, it must refuse too — and the amount is
  // checked against the live switch rather than assumed, so this stays correct
  // on the day someone turns payments on.
  const pub = await get("/api/admin/public");
  if (pub.json?.payments?.enabled)
    return { ok: true, info: "rail is ON — only the 401 was assertable" };

  const r = await post(
    "/api/payments/payin",
    { amount: 100 },
    { Authorization: "Bearer " + accountToken },
  );
  // 503 is the correct refusal here (the rail is unavailable), so it counts as
  // passing alongside the 4xx family. Only a 200 would be a failure.
  return {
    ok:
      r.status !== 200 &&
      (r.status === 503 || (r.status >= 400 && r.status < 500)),
    info: `anon=401 authed-off=${r.status}${r.json?.error ? " " + r.json.error : ""}`,
  };
});

await check(
  "payments: public config carries switches, never secrets",
  async () => {
    const r = await get("/api/admin/public");
    const p = r.json?.payments;
    if (!p)
      return { ok: false, info: "no payments block on the public config" };
    const want = ["enabled", "maxAmount", "minAmount", "payoutsEnabled"].sort();
    const got = Object.keys(p).sort();
    const leaked = /secret|apikey/i.test(JSON.stringify(p));
    return {
      ok: got.join(",") === want.join(",") && !leaked,
      info:
        got.join(",") === want.join(",")
          ? `${got.join(", ")}${leaked ? " — LEAKED" : ""}`
          : `unexpected fields: ${got.join(", ")}`,
    };
  },
);

await check(
  "payments: the console never returns the stored secret",
  async () => {
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

    const r = await get("/api/admin/settings", {
      Cookie: "admin_token=" + cookie,
    });
    const p = r.json?.settings?.payments || {};
    // The masked form is `••••last4`; anything else means a real key reached the
    // browser, where it would sit in the DOM and in every proxy log.
    // `webhookSecret` is included because it is a THIRD secret, and the one that
    // actually verifies an incoming callback — easy to forget when listing keys.
    const leak = [
      "payinApiKey",
      "payinApiSecret",
      "payoutApiKey",
      "payoutApiSecret",
      "webhookSecret",
    ].filter((k) => p[k] && !String(p[k]).startsWith("••••"));
    return {
      ok: !leak.length,
      info: leak.length
        ? `plaintext in settings response: ${leak.join(", ")}`
        : `masked (${p.payinApiKey || "pay-in key not set yet"})`,
    };
  },
);

await check(
  "deposit: the ledger refuses a practice credit outright",
  async () => {
    // The old self-service route is gone; this is the second lock. A caller that
    // reaches `recordDeposit` with `method: "self"` is refused AT THE SOURCE, so
    // re-exposing the endpoint by accident cannot reopen the money tap.
    //
    // Idempotency itself moved with the route: `idem` now only arrives from the
    // gateway callback, where the txn id is the key. That path cannot be exercised
    // without a settled payment, and is covered by the live gateway test instead
    // (signed callback 200 → replay 200 duplicate → tampered 401).
    const h = { Authorization: "Bearer " + accountToken };
    const before = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const r = await post(
      "/api/trade/deposit",
      { amount: 100, method: "self", idem: "smoke-" + randomUUID() },
      h,
    );
    const after = (await post("/api/trade", { action: "load" }, h)).json
      ?.account;
    const ok =
      r.status === 410 &&
      Math.abs(Number(after?.deposited) - Number(before?.deposited)) < 0.001;
    return {
      ok,
      info: ok
        ? `refused with 410, deposited unchanged at ${before?.deposited}`
        : `status=${r.status} deposited ${before?.deposited}->${after?.deposited}`,
    };
  },
);

// ── Withdrawals ─────────────────────────────────────────────────────────────
// These hold in every configuration, including the shipped one where the
// pay-out rail is OFF. The deeper ledger maths (a request holds its funds, a
// rejection releases them, a gateway auth failure returns the request to the
// queue) lives in the dedicated probe, which is allowed to move settings; what
// is checked here is the part that must never regress in production.

await check("withdrawals: unauthorised is refused", async () => {
  const g = await get("/api/withdrawals");
  const p = await post("/api/withdrawals", { amount: 1000, accountId: "x" });
  const ok = g.status === 401 && p.status === 401;
  return { ok, info: `GET=${g.status} POST=${p.status}` };
});

await check(
  "withdrawals: a customer sees limits and masked accounts",
  async () => {
    const h = { Authorization: "Bearer " + accountToken };
    const r = await get("/api/withdrawals", h);
    const j = r.json || {};
    const fields = ["withdrawable", "minWithdraw", "maxWithdraw", "enabled"];
    const missing = fields.filter((f) => j[f] === undefined);
    // A destination may only ever leave the server masked, so no 9-18 digit run
    // (a bank account number) may appear anywhere in the payload.
    const rawAccountNumber = /\d{9,18}/.test(JSON.stringify(j));
    const shaped = (j.accounts || []).every(
      (a) => a.description && !a.account_number && !a.upi_id,
    );
    const ok =
      r.status === 200 && !missing.length && !rawAccountNumber && shaped;
    return {
      ok,
      info: missing.length
        ? `missing: ${missing.join(", ")}`
        : rawAccountNumber
          ? "a raw account number reached the browser"
          : `withdrawable=₹${j.withdrawable} min=₹${j.minWithdraw} max=₹${j.maxWithdraw} rail=${j.enabled ? "on" : "off"} accounts=${(j.accounts || []).length}`,
    };
  },
);

await check(
  "withdrawals: the free balance agrees with the trading ledger",
  async () => {
    // One number, two endpoints. If these ever diverge, the withdraw form is
    // offering an amount the request will refuse — or worse, more than is there.
    const h = { Authorization: "Bearer " + accountToken };
    const w = (await get("/api/withdrawals", h)).json || {};
    const t =
      (await post("/api/trade", { action: "load" }, h)).json?.account || {};
    const ok =
      Math.abs(Number(w.withdrawable) - Number(t.withdrawable)) < 0.01 &&
      Math.abs(Number(w.withdrawn) - Number(t.withdrawn)) < 0.01;
    return {
      ok,
      info: `withdrawals=${w.withdrawable} trade=${t.withdrawable} held=${w.withdrawn}`,
    };
  },
);

await check("withdrawals: a bad request never creates a row", async () => {
  const h = { Authorization: "Bearer " + accountToken };
  const before = ((await get("/api/withdrawals", h)).json?.withdrawals || [])
    .length;
  const state = (await get("/api/withdrawals", h)).json || {};

  // An unknown destination is refused whatever the rail is doing; if pay-outs
  // are switched off the rail check answers first, and that is also a refusal.
  const over = await post(
    "/api/withdrawals",
    { amount: 9_000_000, accountId: "not-a-real-account" },
    h,
  );
  const after = ((await get("/api/withdrawals", h)).json?.withdrawals || [])
    .length;
  const refused = over.status >= 400;
  const ok = refused && before === after;
  return {
    ok,
    info: ok
      ? `refused with ${over.status} ("${String(over.json?.error || "").slice(0, 60)}"), rows ${before}->${after}`
      : `status=${over.status} rows ${before}->${after} rail=${state.enabled ? "on" : "off"}`,
  };
});

await check(
  "withdrawals: the request path rejects a foreign account",
  async () => {
    // Cross-user theft is the failure that matters here: a customer must not be
    // able to name someone else's saved destination and have the money sent there.
    const h = { Authorization: "Bearer " + accountToken };
    const state = (await get("/api/withdrawals", h)).json || {};
    if (!state.enabled) {
      // Rail off — the request path is closed entirely, which is the stronger
      // statement. Report it rather than pretending this proved the ownership rule.
      const r = await post(
        "/api/withdrawals",
        { amount: 1000, accountId: "u-00000000/foreign" },
        h,
      );
      return {
        ok: r.status === 503,
        info: `rail off — request refused with ${r.status}`,
      };
    }
    const r = await post(
      "/api/withdrawals",
      { amount: 1000, accountId: "u-00000000/foreign" },
      h,
    );
    return {
      ok: r.status === 400 && /account/i.test(String(r.json?.error || "")),
      info: `status=${r.status} error=${JSON.stringify(r.json?.error)}`,
    };
  },
);

await check("withdrawals: the KYC policy reaches the customer", async () => {
  // Two levels decide this — a platform switch and a per-user override — and
  // the customer panel renders its copy from these fields. So the fields have
  // to be present, and they have to agree with each other: a panel told
  // "required" while `kycBlocked` says false is a form that offers a withdrawal
  // the server then refuses.
  const h = { Authorization: "Bearer " + accountToken };
  const j = (await get("/api/withdrawals", h)).json || {};
  const shapes =
    typeof j.kycRequired === "boolean" &&
    typeof j.kycBlocked === "boolean" &&
    typeof j.kycEligible === "boolean";
  const sources = ["site", "user-required", "user-waived"];
  const sourced = sources.includes(j.kycSource);
  const agrees = j.kycBlocked === (j.kycRequired && !j.kycEligible);
  return {
    ok: shapes && sourced && agrees,
    info: !shapes
      ? `missing/ill-typed: required=${j.kycRequired} blocked=${j.kycBlocked} eligible=${j.kycEligible}`
      : !sourced
        ? `unexpected source: ${j.kycSource}`
        : !agrees
          ? `blocked=${j.kycBlocked} but required=${j.kycRequired} eligible=${j.kycEligible}`
          : `required=${j.kycRequired} (${j.kycSource}) eligible=${j.kycEligible} blocked=${j.kycBlocked}`,
  };
});

await check(
  "withdrawals: the KYC switch cannot move without a session",
  async () => {
    // The switch decides whether money can leave an unverified account, so a
    // signed-out caller must not be able to flip it. The settings route is
    // superadmin-only; this proves the gate is actually reached.
    const r = await post("/api/admin/settings", {
      kyc: { withdrawRequiresKyc: false },
    });
    return { ok: r.status >= 400, info: `status=${r.status}` };
  },
);

console.log("\n─── smoke results ───");
for (const line of results) console.log(line);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
