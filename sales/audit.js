// Audit: does every screenshot in the page have BOTH a light and a dark frame,
// and do both files exist on disk?
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "index.html");
const h = fs.readFileSync(file, "utf8");

// every <img ...> in document order, tagged with its class and src
const imgs = [...h.matchAll(/<img\b[^>]*>/g)].map((m) => {
  const tag = m[0];
  const cls = (tag.match(/class="([^"]*)"/) || [, ""])[1];
  const src = (tag.match(/src="([^"]*)"/) || [, ""])[1];
  return { cls, src, raw: tag };
});

console.log("total <img>:", imgs.length);

const missingFile = [];
const loneLight = []; // a light frame with no dark sibling right after it
const loneDark = [];

for (let i = 0; i < imgs.length; i++) {
  const im = imgs[i];
  if (!im.src.startsWith("shots/")) continue;
  if (!fs.existsSync(path.join(__dirname, im.src))) missingFile.push(im.src);

  const isL = /\bl\b/.test(im.cls);
  const isD = /\bd\b/.test(im.cls);
  if (isL) {
    const next = imgs[i + 1];
    if (!next || !/\bd\b/.test(next.cls)) {
      loneLight.push(im.src);
    } else {
      // dark sibling must exist on disk
      if (!fs.existsSync(path.join(__dirname, next.src)))
        missingFile.push(next.src + " (dark sibling)");
    }
  } else if (isD) {
    const prev = imgs[i - 1];
    if (!prev || !/\bl\b/.test(prev.cls)) loneDark.push(im.src);
  } else {
    // no theme class at all -> will never swap
    loneLight.push(im.src + "  [NO class l/d]");
  }
}

console.log("\n--- missing files on disk ---");
console.log(missingFile.length ? missingFile.join("\n") : "none");

console.log("\n--- light frames with NO dark sibling (break in dark mode) ---");
console.log(loneLight.length ? loneLight.join("\n") : "none");

console.log("\n--- orphan dark frames ---");
console.log(loneDark.length ? loneDark.join("\n") : "none");

// which dark-mobile files exist at all?
const shots = fs.readdirSync(path.join(__dirname, "shots"));
const mobiles = shots.filter((f) => f.includes("-mobile"));
const mobileDark = mobiles.filter((f) => f.includes("dark"));
console.log("\n--- mobile shots ---");
console.log(
  "mobile total:",
  mobiles.length,
  "| mobile with a dark variant:",
  mobileDark.length,
);
console.log(
  "mobile WITHOUT dark:",
  mobiles.filter((f) => !f.includes("dark")).join(", "),
);
