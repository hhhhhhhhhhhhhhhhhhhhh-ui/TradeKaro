// Many more mobile captures, focused on the trading POV: how positions look and
// how you actually trade from a phone.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");
const USER = "arjun.trader";
const PASS = "Sales@1234";

// Re-seed a funded book so the position screens actually have rows.
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
  const rows = [
    ["RELIANCE", 25, 1240.4, "CNC", 250],
    ["HDFCBANK", 40, 738.6, "CNC", 205],
    ["TCS", 15, 2105, "CNC", 160],
    ["SBIN", 50, 987, "CNC", 95],
  ];
  for (const [sym, qty, price, product, min] of rows) {
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
      product,
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
    "fills",
  );
  db.close();
}

(async () => {
  reseed();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
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

  const shot = async (name) => {
    const out = path.join(OUT, name + ".jpg");
    await page.screenshot({ path: out, type: "jpeg", quality: 84 });
    console.log(
      `  ${name}.jpg  ${Math.round(fs.statSync(out).size / 1024)}KB  ${page.url().replace(BASE, "")}`,
    );
  };

  const go = async (file) => {
    await page
      .goto(BASE + file, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    await page.waitForTimeout(2400);
  };

  // simple pages
  for (const [name, file] of [
    ["watchlist-mobile", "/watchlist"],
    ["screener-mobile", "/screener"],
    ["topmovers-mobile", "/topmovers"],
    ["news-mobile", "/news"],
    ["ledger-mobile", "/ledger"],
    ["portfolio-mobile", "/portfolio"],
    ["profile-mobile", "/profile"],
    ["settings-mobile", "/settings"],
    ["connect-mobile", "/connect"],
  ]) {
    await go(file);
    await shot(name);
  }

  // ── the trading flow ──────────────────────────────────────────────────────
  await go("/positions");
  await shot("positions-mobile");

  // tap the first row -> the position sheet
  await page.click(".pr-card-inner", { force: true }).catch(() => {});
  await page.waitForTimeout(900);
  await shot("position-sheet-mobile");

  // arm Partial Exit -> qty stepper appears
  await page.click(".pr-action.is-exit", { force: true }).catch(() => {});
  await page.waitForTimeout(800);
  await shot("position-partial-exit-mobile");

  // arm Add More instead
  await page.click(".pr-action.is-add", { force: true }).catch(() => {});
  await page.waitForTimeout(800);
  await shot("position-add-more-mobile");

  // ledger strip expanded lives on the list behind the sheet; close and open it
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page
    .click(".pr-tabs-icons button:last-child", { force: true })
    .catch(() => {});
  await page.waitForTimeout(700);
  await shot("positions-ledger-mobile");
  await page.click(".pr-tab", { force: true }).catch(() => {});
  await page.waitForTimeout(700);
  await shot("positions-closed-mobile");

  // stock ticket
  await go("/stocks/RELIANCE");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /BUY\s*\[B\/S\]|BUY NOW/i.test(x.textContent || ""),
    );
    if (b) b.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(900);
  await shot("stock-ticket-mobile");

  await go("/options");
  await shot("options-mobile");

  await go("/commodities");
  await shot("commodities-mobile");

  await go("/dashboard");
  await shot("dashboard-mobile");

  await ctx.close();
  await browser.close();
  console.log("done");
})();
