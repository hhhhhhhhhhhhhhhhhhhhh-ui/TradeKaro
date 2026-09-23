// Capture BOTH themes for every mobile frame, from the same page state, in one
// pass.
//
// Why this exists: the app defaults to dark when localStorage has no "theme"
// (app/layout.tsx -> `t ? t === "dark" : true`). capture-mobile.js never set a
// theme, so all 27 of the "light" mobile shots were actually dark captures --
// light mode showed dark frames, and dark mode showed the dark twin. Both
// looked dark. This script forces light before first paint, shoots, flips the
// real ThemeToggle, shoots again, so the pair is byte-comparable apart from
// theme.
const { chromium } = require("playwright-core");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(__dirname, "shots");
const USER = "arjun.trader";
const PASS = "Sales@1234";

// Fixed clock so the light and dark twins show identical fill timestamps.
// 10:41:52 UTC == 16:11:52 IST; minus each row's age reproduces the times
// already published in the sales page (RELIANCE 12:01:52 PM, etc).
const BASE_TS = Date.UTC(2026, 8, 23, 10, 41, 52);

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
  ).run(key, 500000, BASE_TS);
  db.prepare("DELETE FROM trade_fills WHERE user_id = ?").run(key);
  const ins = db.prepare(
    `INSERT INTO trade_fills
       (user_id, ts, idem, symbol, kind, side, qty, price, value, charges,
        product, meta, source, ref_price, ref_ts)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const [sym, qty, price, min] of [
    ["RELIANCE", 25, 1240.4, 250],
    ["HDFCBANK", 40, 738.6, 205],
    ["TCS", 15, 2105, 160],
    ["SBIN", 50, 987, 95],
  ]) {
    const ts = BASE_TS - min * 60000;
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
    "fills",
  );
  db.close();
}

const isDark = (page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

const MOBILE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};

async function main() {
  reseed();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
  });

  // Force light before any page script runs, on every navigation.
  const newCtx = () =>
    browser.newContext(MOBILE).then(async (ctx) => {
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("theme", "light");
        } catch {}
      });
      return ctx;
    });

  // Flip to `want` using the app's own toggle when it is actually reachable, so
  // React state (and therefore canvas chart theming) follows. Falls back to the
  // <html> class otherwise -- which also protects the position-sheet frames,
  // where a click at the navbar's position would land on the closing overlay.
  const flip = async (page, want) => {
    if (((await isDark(page)) ? "dark" : "light") === want) return want;
    const btn = page.locator('button[title^="Theme:"]').first();
    let clicked = false;
    if (await btn.count()) {
      // Only click if the button is genuinely the topmost element there.
      const reachable = await btn
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          const t = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return !!t && (t === el || el.contains(t));
        })
        .catch(() => false);
      if (reachable) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
        clicked = true;
      }
    }
    if (((await isDark(page)) ? "dark" : "light") !== want) {
      await page.evaluate((w) => {
        document.documentElement.classList.toggle("dark", w === "dark");
        try {
          localStorage.setItem("theme", w);
        } catch {}
      }, want);
      await page.waitForTimeout(500);
      console.log(
        `    (${clicked ? "toggle did not take" : "toggle not reachable"} on ${page.url().replace(BASE, "")} — set class directly)`,
      );
    }
    return (await isDark(page)) ? "dark" : "light";
  };

  const go = async (page, file) => {
    await page
      .goto(BASE + file, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    await page.waitForTimeout(2200);
  };

  // Shoot the current page state in the given theme and assert it really landed
  // in that theme -- this is the check that the original capture never had.
  let bad = 0;
  const shot = async (page, name, expect) => {
    const out = path.join(OUT, name + ".jpg");
    await page.screenshot({ path: out, type: "jpeg", quality: 84 });
    const actual = (await isDark(page)) ? "dark" : "light";
    const ok = actual === expect;
    if (!ok) bad++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${name}.jpg ${String(Math.round(fs.statSync(out).size / 1024)).padStart(3)}KB want=${expect} got=${actual} ${page.url().replace(BASE, "")}`,
    );
  };

  const pair = async (page, base) => {
    await flip(page, "light");
    await shot(page, base + "-mobile", "light");
    await flip(page, "dark");
    await shot(page, base + "-mobile-dark", "dark");
    await flip(page, "light");
  };

  // ── plain pages (signed in) ───────────────────────────────────────────────
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
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
    for (const [base, file] of [
      ["dashboard", "/dashboard"],
      ["stocks", "/stocks"],
      ["stock-detail", "/stocks/RELIANCE"],
      ["options", "/options"],
      ["commodities", "/commodities"],
      ["watchlist", "/watchlist"],
      ["screener", "/screener"],
      ["topmovers", "/topmovers"],
      ["news", "/news"],
      ["ledger", "/ledger"],
      ["portfolio", "/portfolio"],
      ["orders", "/portfolio/orders"],
      ["wallet", "/wallet"],
      ["profile", "/profile"],
      ["settings", "/settings"],
      ["connect", "/connect"],
    ]) {
      await go(page, file);
      await pair(page, base);
    }
    // stock ticket, scrolled to the buy control
    await go(page, "/stocks/RELIANCE");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        /BUY\s*\[B\/S\]|BUY NOW/i.test(x.textContent || ""),
      );
      if (b) b.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(900);
    await pair(page, "stock-ticket");
    await ctx.close();
  }

  // ── logged-out landing page ───────────────────────────────────────────────
  // A signed-in visitor is redirected to /dashboard, so this needs its own
  // context with no session cookie.
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await go(page, "/");
    const landed = page.url().replace(BASE, "");
    console.log(`\n[home] landed ${landed}`);
    if (landed !== "/") console.log("  !! / redirected, not the landing page");
    await pair(page, "home");
    await ctx.close();
  }

  // ── positions flow ────────────────────────────────────────────────────────
  {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await go(page, "/login");
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
    await go(page, "/positions");
    await page.waitForTimeout(600);
    await pair(page, "positions");

    await page.click(".pr-card-inner", { force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    await pair(page, "position-sheet");

    await page.click(".pr-action.is-exit", { force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await pair(page, "position-partial-exit");

    await page.click(".pr-action.is-add", { force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await pair(page, "position-add-more");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page
      .click(".pr-tabs-icons button:last-child", { force: true })
      .catch(() => {});
    await page.waitForTimeout(800);
    await pair(page, "positions-ledger");

    await page.click(".pr-tab", { force: true }).catch(() => {});
    await page.waitForTimeout(800);
    await pair(page, "positions-closed");
    await ctx.close();
  }

  // ── admin + partner ───────────────────────────────────────────────────────
  for (const [role, creds, pages] of [
    [
      "admin",
      { url: "/admin/login", user: "admin@demo.local", pass: "Demo@123456" },
      [["admin", "/admin"]],
    ],
    [
      "partner",
      {
        url: "/partners/login",
        user: "demo@tradestox.pro",
        pass: "Partner@Demo1",
      },
      [
        ["partner-dashboard", "/partners/dashboard"],
        ["partner-links", "/partners/links"],
      ],
    ],
  ]) {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await page.goto(BASE + creds.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
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
    for (const [base, file] of pages) {
      await go(page, file);
      await pair(page, base);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(
    bad
      ? `\nDONE with ${bad} frame(s) in the wrong theme`
      : "\nDONE — all frames themed correctly",
  );
}

main();
