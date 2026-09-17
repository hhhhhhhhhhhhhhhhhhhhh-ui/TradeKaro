// Codebase size stats: node scripts/stats.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SKIP = new Set(["node_modules", ".next", ".git", "data", "public"]);
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md"]);

const total = { files: 0, lines: 0, bytes: 0 };
const byTop = {};
const byExt = {};
const files = [];

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    const ext = extname(e.name);
    if (!EXT.has(ext)) continue;
    if (e.name.endsWith(".log") || e.name.endsWith(".tsbuildinfo")) continue;
    if (e.name === "package-lock.json") continue;
    const src = readFileSync(p, "utf8");
    const lines = src.split("\n").length;
    const bytes = statSync(p).size;
    total.files++;
    total.lines += lines;
    total.bytes += bytes;
    const rel = p.slice(process.cwd().length + 1).replace(/\\/g, "/");
    const top =
      rel.split("/")[0] === rel
        ? "(root)"
        : rel.split("/").slice(0, 2).join("/");
    byTop[top] = byTop[top] || { files: 0, lines: 0 };
    byTop[top].files++;
    byTop[top].lines += lines;
    byExt[ext] = byExt[ext] || { files: 0, lines: 0 };
    byExt[ext].files++;
    byExt[ext].lines += lines;
    files.push({ rel, lines, bytes });
  }
}

walk(process.cwd());

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `\n══ TOTAL: ${total.files} files · ${total.lines.toLocaleString()} lines · ${(total.bytes / 1024).toFixed(0)} KB\n`,
);
console.log("BY EXTENSION");
for (const [ext, v] of Object.entries(byExt).sort(
  (a, b) => b[1].lines - a[1].lines,
))
  console.log(
    `  ${pad(ext, 7)} ${pad(v.files, 5)} files  ${v.lines.toLocaleString().padStart(7)} lines`,
  );
console.log("\nBY AREA (top 2 levels)");
for (const [k, v] of Object.entries(byTop)
  .sort((a, b) => b[1].lines - a[1].lines)
  .slice(0, 16))
  console.log(
    `  ${pad(k, 40)} ${pad(v.files, 5)} files  ${v.lines.toLocaleString().padStart(7)} lines`,
  );
console.log("\nBIGGEST FILES");
for (const f of files.sort((a, b) => b.lines - a.lines).slice(0, 10))
  console.log(`  ${pad(f.lines.toLocaleString(), 7)} lines  ${f.rel}`);
console.log();
