// home-mobile-dark came back as /dashboard: a signed-in visitor gets redirected
// off "/". The landing page needs a logged-OUT context.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(__dirname, "shots");

(async () => {
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
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" }); // no login
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try {
      localStorage.setItem("theme", "dark");
    } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const url = page.url().replace("http://127.0.0.1:3000", "");
  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  const out = path.join(OUT, "home-mobile-dark.jpg");
  await page.screenshot({ path: out, type: "jpeg", quality: 84 });
  console.log(
    `home-mobile-dark.jpg ${Math.round(fs.statSync(out).size / 1024)}KB url=${url} dark=${dark}`,
  );
  await browser.close();
})();
