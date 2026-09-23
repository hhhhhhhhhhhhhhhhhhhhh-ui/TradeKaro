// Dark-mode captures for every mobile frame. The page's phone frames only had a
// light <img>, and the CSS hides .l in dark mode -> the whole mobile section went
// blank. Every mobile shot needs a dark twin.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");
const USER = "arjun.trader";
const PASS = "Sales@1234";

function reseed() {
  const db = new DatabaseSync(path.join(__dirname, "..", "data", "trade.db"));
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(USER);
  if (!u) {
    console.log("!! user missing");
    db.close();
    return;
  }
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
  for (const [sym, qty, price, min] of [
    ["RELIANCE", 25, 1240.4, 250],
    ["HDFCBANK", 40, 738.6, 205],
    ["TCS", 15, 2105, 160],
    ["SBIN", 50, 987, 95],
  ]) {
    const ts = now - min * 60000;
    ins.run(
      key,
      ts,
      `seed-${sym}-${min}`,
      sym,
      "STOCK",
      "BUY",
      qty,
      price,
      qty * price,
      20,
      "CNC",
      null,
      "imported",
      price,
      ts,
    );
  }
  console.log(
    "seeded",
    db.prepare("SELECT COUNT(*) m FROM trade_fills WHERE user_id = ?").get(key)
      .m,
  );
  db.close();
}

async function run() {
  reseed();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });

  // helper: fresh dark context + signed in
  const mk = async () => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {}
    });
    await page.evaluate(
      async (c) => {
        await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c),
        });
      },
      { username: USER, password: PASS },
    );
    return { ctx, page };
  };

  const shot = async (page, name) => {
    const out = path.join(OUT, name + ".jpg");
    await page.screenshot({ path: out, type: "jpeg", quality: 84 });
    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    console.log(
      `  ${name}.jpg ${Math.round(fs.statSync(out).size / 1024)}KB dark=${dark} ${page.url().replace(BASE, "")}`,
    );
  };

  // ── plain pages ───────────────────────────────────────────────────────────
  {
    const { ctx, page } = await mk();
    for (const [name, file] of [
      ["home-mobile-dark", "/"],
      ["dashboard-mobile-dark", "/dashboard"],
      ["stocks-mobile-dark", "/stocks"],
      ["stock-detail-mobile-dark", "/stocks/RELIANCE"],
      ["options-mobile-dark", "/options"],
      ["commodities-mobile-dark", "/commodities"],
      ["watchlist-mobile-dark", "/watchlist"],
      ["screener-mobile-dark", "/screener"],
      ["topmovers-mobile-dark", "/topmovers"],
      ["news-mobile-dark", "/news"],
      ["ledger-mobile-dark", "/ledger"],
      ["portfolio-mobile-dark", "/portfolio"],
      ["orders-mobile-dark", "/portfolio/orders"],
      ["wallet-mobile-dark", "/wallet"],
      ["profile-mobile-dark", "/profile"],
      ["settings-mobile-dark", "/settings"],
      ["connect-mobile-dark", "/connect"],
    ]) {
      await page
        .goto(BASE + file, { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await page.waitForTimeout(2200);
      await shot(page, name);
    }
    // stock ticket, scrolled to the buy control
    await page.goto(BASE + "/stocks/RELIANCE", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        /BUY\s*\[B\/S\]|BUY NOW/i.test(x.textContent || ""),
      );
      if (b) b.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(900);
    await shot(page, "stock-ticket-mobile-dark");
    await ctx.close();
  }

  // ── positions flow ────────────────────────────────────────────────────────
  {
    const { ctx, page } = await mk();
    await page.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    await shot(page, "positions-mobile-dark");

    await page.click(".pr-card-inner", { force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    await shot(page, "position-sheet-mobile-dark");

    await page.click(".pr-action.is-exit", { force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, "position-partial-exit-mobile-dark");

    await page.click(".pr-action.is-add", { force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, "position-add-more-mobile-dark");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page
      .click(".pr-tabs-icons button:last-child", { force: true })
      .catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "positions-ledger-mobile-dark");

    await page.click(".pr-tab", { force: true }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "positions-closed-mobile-dark");
    await ctx.close();
  }

  // ── admin + partner ───────────────────────────────────────────────────────
  for (const [role, creds, pages] of [
    [
      "admin",
      { url: "/admin/login", user: "admin@demo.local", pass: "Demo@123456" },
      [["admin-mobile-dark", "/admin"]],
    ],
    [
      "partner",
      {
        url: "/partners/login",
        user: "demo@tradestox.pro",
        pass: "Partner@Demo1",
      },
      [
        ["partner-dashboard-mobile-dark", "/partners/dashboard"],
        ["partner-links-mobile-dark", "/partners/links"],
      ],
    ],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + creds.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      try {
        localStorage.setItem("theme", "dark");
      } catch {}
    });
    const inputs = page.locator("input");
    const n = await inputs.count();
    for (let i = 0; i < n; i++) {
      const t = await inputs.nth(i).getAttribute("type");
      if (t === "password") continue;
      await inputs.nth(i).fill(creds.user);
      break;
    }
    const pw = page.locator('input[type="password"]').first();
    if (await pw.count()) await pw.fill(creds.pass);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2800);
    for (const [name, file] of pages) {
      await page.goto(BASE + file, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2400);
      await shot(page, name);
    }
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

run();
