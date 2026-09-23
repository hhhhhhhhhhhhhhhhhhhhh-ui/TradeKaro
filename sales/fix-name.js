// The dashboard screenshot greeted the test user ("sales_xxxx"). Rename it to
// something presentable and re-shoot just the dashboard frames.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");
const NEW = "arjun.trader";
const PASS = "Sales@1234";

(async () => {
  const db = new DatabaseSync(path.join(__dirname, "..", "data", "trade.db"));
  const row = db
    .prepare(
      "SELECT id, username FROM users WHERE username LIKE 'sales_%' ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  if (!row) {
    console.log("no sales_* user");
    db.close();
    return;
  }
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(NEW, row.id);
  console.log("renamed", row.username, "->", NEW);
  db.close();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });
  const shots = [
    ["dashboard-light", "light", { width: 1440, height: 900 }, false],
    ["dashboard-dark", "dark", { width: 1440, height: 900 }, false],
    ["dashboard-mobile", "light", { width: 390, height: 844 }, true],
  ];
  for (const [name, theme, vp, mobile] of shots) {
    const ctx = await browser.newContext({
      viewport: vp,
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: mobile ? 2 : 1,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const r = await page.evaluate(
      async (c) => {
        const res = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c),
        });
        return res.status;
      },
      { username: NEW, password: PASS },
    );
    await page.evaluate((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);
    await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const out = path.join(OUT, name + ".jpg");
    await page.screenshot({ path: out, type: "jpeg", quality: 84 });
    console.log(
      `  ${name}.jpg login=${r} ${Math.round(fs.statSync(out).size / 1024)}KB -> ${page.url().replace(BASE, "")}`,
    );
    await ctx.close();
  }
  await browser.close();
  console.log("done");
})();
