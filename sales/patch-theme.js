// Give every phone frame a dark sibling, and make the phone CSS hide/show the
// right one per theme. Without this the whole mobile section went blank in dark.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "index.html");
let h = fs.readFileSync(file, "utf8");

// ── 1. add <img class="d"> after every mobile <img class="l"> ───────────────
// Matches both the one-line and the prettier multi-line form, and is idempotent:
// a light frame that already has its dark sibling is left alone.
const IMG_L =
  /(([ \t]*)<img\s+class="l"\s+src="(shots\/[^"]*-mobile\.jpg)"(\s+alt="([^"]*)")?\s*\/?>)(?![\s\S]{0,40}<img\s+class="d")/g;
let added = 0;
h = h.replace(IMG_L, (m, _whole, indent, src, _altGroup, alt) => {
  const dark = src.replace(/-mobile\.jpg$/, "-mobile-dark.jpg");
  if (!fs.existsSync(path.join(__dirname, dark))) {
    console.log("  !! no dark file for", src);
    return m;
  }
  added++;
  return `${m}\n${indent}<img class="d" src="${dark}" alt="${alt || ""}" />`;
});
console.log("dark siblings added:", added);

// ── 2. phone CSS: show .l in light, .d in dark ──────────────────────────────
const oldPhoneCss =
  /\.phone\s+\.frame\s+img\s*\{[^}]*\}\s*body\.shots-dark\s+\.phone\s+\.frame\s+img\.l\s*\{[^}]*\}/;
const newPhoneCss = `.phone .frame img {
        width: 100%;
        display: block;
      }
      .phone .frame img.d {
        display: none;
      }
      body.shots-dark .phone .frame img.l {
        display: none;
      }
      body.shots-dark .phone .frame img.d {
        display: block;
      }`;
if (oldPhoneCss.test(h)) {
  h = h.replace(oldPhoneCss, newPhoneCss);
  console.log("phone CSS: rewritten");
} else {
  console.log("!! phone CSS pattern not found — dumping nearby text:");
  const i = h.indexOf(".phone .frame img");
  console.log(JSON.stringify(h.slice(i - 40, i + 320)));
}

fs.writeFileSync(file, h);
console.log("written. lines:", h.split("\n").length);
