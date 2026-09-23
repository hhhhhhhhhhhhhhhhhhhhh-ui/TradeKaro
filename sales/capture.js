// Capture the screenshots for the sales page.
// Drives the locally-installed Chrome via playwright-core (no browser download).
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const CREDS = {
  user: { url: "/login", user: "uiview_muciry2t", pass: "Smoke@1234" },
  admin: { url: "/admin/login", user: "admin@demo.local", pass: "Demo@123456" },
  partner: {
    url: "/partners/login",
    user: "demo@tradestox.pro",
    pass: "Partner@Demo1",
  },
};

const USER_PAGES = [
  ["home", "/"],
  ["dashboard", "/dashboard"],
  ["stocks", "/stocks"],
  ["stock-detail", "/stocks/RELIANCE"],
  ["options", "/options"],
  ["commodities", "/commodities"],
  ["watchlist", "/watchlist"],
  ["screener", "/screener"],
  ["topmovers", "/topmovers"],
  ["news", "/news"],
  ["positions", "/positions"],
  ["portfolio", "/portfolio"],
  ["orders", "/portfolio/orders"],
  ["ledger", "/ledger"],
  ["wallet", "/wallet"],
  ["profile", "/profile"],
  ["settings", "/settings"],
  ["connect", "/connect"],
];

const ADMIN_PAGES = [
  ["admin-login", "/admin/login"],
  ["admin", "/admin"],
];

const PARTNER_PAGES = [
  ["partner-login", "/partners/login"],
  ["partner-dashboard", "/partners/dashboard"],
  ["partner-links", "/partners/links"],
  ["partner-stats", "/partners/stats"],
  ["partner-earnings", "/partners/earnings"],
  ["partner-referrals", "/partners/referrals"],
  ["partner-tracking", "/partners/tracking"],
  ["partner-payouts", "/partners/payouts"],
  ["partner-profile", "/partners/profile"],
];

const MOBILE_PAGES = [
  ["user", "home", "/"],
  ["user", "dashboard", "/dashboard"],
  ["user", "stocks", "/stocks"],
  ["user", "stock-detail", "/stocks/RELIANCE"],
  ["user", "options", "/options"],
  ["user", "commodities", "/commodities"],
  ["user", "positions", "/positions"],
  ["user", "wallet", "/wallet"],
  ["user", "orders", "/portfolio/orders"],
  ["admin", "admin", "/admin"],
  ["partner", "partner-dashboard", "/partners/dashboard"],
  ["partner", "partner-links", "/partners/links"],
];

async function signIn(page, role) {
  const c = CREDS[role];
  await page.goto(BASE + c.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const inputs = page.locator("input");
  const n = await inputs.count();
  let filledUser = false;
  for (let i = 0; i < n; i++) {
    const t = await inputs.nth(i).getAttribute("type");
    if (t === "password") continue;
    await inputs.nth(i).fill(c.user);
    filledUser = true;
    break;
  }
  const pw = page.locator('input[type="password"]').first();
  if (await pw.count()) await pw.fill(c.pass);
  if (filledUser) await page.keyboard.press("Enter");
  await page.waitForTimeout(2800);
  return page.url();
}

async function shoot(page, name, file, full = false) {
  try {
    await page.goto(BASE + file, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2200);
    const target = path.join(OUT, name + ".jpg");
    await page.screenshot({
      path: target,
      fullPage: full,
      type: "jpeg",
      quality: 84,
    });
    const kb = Math.round(fs.statSync(target).size / 1024);
    console.log(`  ok ${name}.jpg  ${kb}KB  ${page.url().replace(BASE, "")}`);
    return true;
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message.split("\n")[0].slice(0, 90)}`);
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });

  // ── desktop ───────────────────────────────────────────────────────────────
  for (const theme of ["light", "dark"]) {
    for (const role of ["user", "admin", "partner"]) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await ctx.newPage();
      const landed = await signIn(page, role);
      console.log(
        `\n[${theme}] ${role} signed in -> ${landed.replace(BASE, "")}`,
      );
      const list =
        role === "user"
          ? USER_PAGES
          : role === "admin"
            ? ADMIN_PAGES
            : PARTNER_PAGES;
      for (const [name, file] of list) {
        if (theme === "dark") {
          await page.evaluate(() => {
            try {
              localStorage.setItem("theme", "dark");
            } catch {}
          });
        } else {
          await page.evaluate(() => {
            try {
              localStorage.setItem("theme", "light");
            } catch {}
          });
        }
        await shoot(page, `${name}-${theme}`, file);
      }
      await ctx.close();
    }
  }

  // ── mobile ────────────────────────────────────────────────────────────────
  for (const role of ["user", "admin", "partner"]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await signIn(page, role);
    console.log(`\n[mobile] ${role}`);
    for (const [r, name, file] of MOBILE_PAGES) {
      if (r !== role) continue;
      await page.evaluate(() => {
        try {
          localStorage.setItem("theme", "light");
        } catch {}
      });
      await shoot(page, `${name}-mobile`, file);
    }
    await ctx.close();
  }

  await browser.close();
  const files = fs.readdirSync(OUT);
  console.log(`\nDONE — ${files.length} screenshots in sales/shots`);
})();
