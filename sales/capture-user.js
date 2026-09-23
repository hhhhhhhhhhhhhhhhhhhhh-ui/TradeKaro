// Register a trader, give it a funded ledger with real positions, then capture
// the logged-in user pages. The earlier capture.js run failed to sign in as the
// old test user, so every gated page came back as the login screen.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");

const USER = "sales_" + Date.now().toString(36);
const PASS = "Sales@1234";

const PAGES = [
  ["dashboard", "/dashboard"],
  ["positions", "/positions"],
  ["orders", "/portfolio/orders"],
  ["portfolio", "/portfolio"],
  ["ledger", "/ledger"],
  ["wallet", "/wallet"],
  ["watchlist", "/watchlist"],
  ["profile", "/profile"],
  ["settings", "/settings"],
  ["connect", "/connect"],
  ["stock-detail", "/stocks/RELIANCE"],
  ["options", "/options"],
];
const MOBILE = ["dashboard", "positions", "wallet", "orders", "stock-detail"];

async function main() {
  // ── 1. register ───────────────────────────────────────────────────────────
  const reg = await fetch(BASE + "/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: USER,
      email: `${USER}@test.local`,
      password: PASS,
      phone: "9" + String(Date.now()).slice(-9),
    }),
  });
  console.log("register:", reg.status, USER);

  // ── 2. seed a funded ledger with positions ────────────────────────────────
  const db = new DatabaseSync(path.join(__dirname, "..", "data", "trade.db"));
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(USER);
  if (!u) {
    console.log("!! user row not found; skipping seed");
  } else {
    const key = `u-${u.id}`;
    db.prepare(
      `INSERT INTO trade_accounts (user_id, start_cash, seeded_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET start_cash = excluded.start_cash`,
    ).run(key, 500000, Date.now());
    db.prepare("DELETE FROM trade_fills WHERE user_id = ?").run(key);
    const ins = db.prepare(
      `INSERT INTO trade_fills
         (user_id, ts, idem, symbol, kind, side, qty, price, value, charges,
          product, meta, source, ref_price, ref_ts)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const now = Date.now();
    const rows = [
      ["RELIANCE", 25, 1240.4, "CNC", "BUY", 250],
      ["HDFCBANK", 40, 738.6, "CNC", "BUY", 205],
      ["TCS", 15, 2105, "CNC", "BUY", 160],
      ["INFY", 60, 1029.4, "MIS", "BUY", 120],
      ["SBIN", 50, 987, "MIS", "BUY", 95],
      ["TATAMOTORS", 80, 300.05, "MIS", "BUY", 70],
    ];
    for (const [sym, qty, price, product, side, min] of rows) {
      const ts = now - min * 60000;
      ins.run(
        key,
        ts,
        `seed-${sym}-${min}`,
        sym,
        "STOCK",
        side,
        qty,
        price,
        qty * price,
        20,
        product,
        null,
        "imported",
        price,
        ts,
      );
    }
    const n = db
      .prepare("SELECT COUNT(*) m FROM trade_fills WHERE user_id = ?")
      .get(key);
    console.log("seeded fills:", n.m, "for", key);
  }
  db.close();

  // ── 3. capture ────────────────────────────────────────────────────────────
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });

  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      try {
        localStorage.setItem("theme", "light");
      } catch {}
    });
    // sign in through the API so the token cookie is set on this context
    const res = await page.evaluate(
      async (c) => {
        const r = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c),
        });
        return { status: r.status, body: await r.text() };
      },
      { username: USER, password: PASS },
    );
    console.log(`[${theme}] login -> ${res.status}`);
    await page.evaluate((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);

    for (const [name, file] of PAGES) {
      await page
        .goto(BASE + file, { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await page.waitForTimeout(2200);
      const landed = page.url().replace(BASE, "");
      const out = path.join(OUT, `${name}-${theme}.jpg`);
      await page.screenshot({ path: out, type: "jpeg", quality: 84 });
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(
        `  ${landed.startsWith("/login") ? "GATED!" : "ok    "} ${name}-${theme}.jpg ${kb}KB -> ${landed}`,
      );
    }
    await ctx.close();
  }

  // mobile
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(1200);
  await mpage.evaluate(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  });
  await mpage.evaluate(
    async (c) => {
      await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(c),
      });
    },
    { username: USER, password: PASS },
  );
  for (const name of MOBILE) {
    const file = PAGES.find((p) => p[0] === name)[1];
    await mpage
      .goto(BASE + file, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    await mpage.waitForTimeout(2200);
    const out = path.join(OUT, `${name}-mobile.jpg`);
    await mpage.screenshot({ path: out, type: "jpeg", quality: 84 });
    console.log(`  mobile ${name} -> ${mpage.url().replace(BASE, "")}`);
  }
  await mctx.close();
  await browser.close();
  console.log("USER PASS:", USER, PASS);
}

main();
