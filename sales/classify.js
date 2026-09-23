// Classify every screenshot by ACTUAL pixel luminance, not by filename.
//
// The bug this catches: capture-mobile.js never set a theme, and the app
// defaults to dark when localStorage has no "theme", so 27 files named
// "*-mobile.jpg" were dark captures. Nothing in the filename, the DOM, or the
// CSS could reveal that -- only the pixels could.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(__dirname, "shots");
const HTML = path.join(__dirname, "index.html");

const html = fs.readFileSync(HTML, "utf8");
const srcs = [
  ...new Set([...html.matchAll(/src="(shots\/[^"]+)"/g)].map((m) => m[1])),
];
const referenced = new Set(srcs.map((s) => s.replace("shots/", "")));

const onDisk = fs.readdirSync(OUT).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
const orphans = onDisk.filter((f) => !referenced.has(f));

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    // lets a file:// page read file:// images into a canvas
    args: ["--allow-file-access-from-files"],
  });
  const page = await browser.newPage();
  await page.goto("file:///" + HTML.replace(/\\/g, "/"), {
    waitUntil: "domcontentloaded",
  });

  const results = await page.evaluate(async (list) => {
    const out = [];
    for (const rel of list) {
      const mean = await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = 48;
            const h = Math.max(
              1,
              Math.round((img.naturalHeight / img.naturalWidth) * w),
            );
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) {
              sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            }
            res(Math.round(sum / (d.length / 4)));
          } catch (e) {
            res("ERR:" + e.name);
          }
        };
        img.onerror = () => res("MISSING");
        img.src = rel + "?cb=" + Date.now() + Math.random();
      });
      out.push({ rel, mean });
    }
    return out;
  }, srcs);

  await browser.close();

  const DARK_MAX = 90;
  const LIGHT_MIN = 160;
  const wantDark = (r) => /-dark\.jpg$/i.test(r);

  const rows = results.map((r) => {
    const tone =
      typeof r.mean !== "number"
        ? "?"
        : r.mean <= DARK_MAX
          ? "dark"
          : r.mean >= LIGHT_MIN
            ? "light"
            : "mid";
    return { ...r, tone, expect: wantDark(r.rel) ? "dark" : "light" };
  });

  const bad = rows.filter((r) => r.tone !== r.expect);
  const unknown = rows.filter((r) => r.tone === "?" || r.tone === "mid");

  console.log(`referenced images: ${srcs.length}`);
  console.log(`unreferenced files in shots/: ${orphans.length}`);
  if (orphans.length) console.log("  " + orphans.join(", "));

  console.log(
    `\n--- tone mismatches (file says one thing, pixels say another) ---`,
  );
  if (!bad.length) console.log("none");
  for (const r of bad) {
    console.log(
      `  ${r.rel}  expected=${r.expect} pixels=${r.tone} mean=${r.mean}`,
    );
  }

  console.log(`\n--- inconclusive (mean luminance in the 90-160 gap) ---`);
  if (!unknown.length) console.log("none");
  for (const r of unknown) console.log(`  ${r.rel}  mean=${r.mean}`);

  const darks = rows.filter((r) => r.tone === "dark");
  const lights = rows.filter((r) => r.tone === "light");
  console.log(
    `\nclassified: ${lights.length} light, ${darks.length} dark, ${rows.length - lights.length - darks.length} unclear`,
  );

  // the specific thing that was broken before
  const mobileLone = rows.filter(
    (r) => /-mobile\.jpg$/i.test(r.rel) && r.tone !== "light",
  );
  console.log(
    `\nlight-branded mobile frames that are NOT light: ${mobileLone.length}`,
  );
  for (const r of mobileLone) console.log(`  ${r.rel} mean=${r.mean}`);

  process.exit(bad.length || unknown.length || mobileLone.length ? 1 : 0);
})();
