// Dev utility for the stored admin settings. The console is the real interface;
// this exists so settings can be inspected and fiddled with from a terminal
// while testing time-of-day behaviour (session window, square-off cutoff).
//
//   node scripts/dev-settings.mjs show
//   node scripts/dev-settings.mjs save   backup.json
//   node scripts/dev-settings.mjs restore backup.json
//   node scripts/dev-settings.mjs patch  '{"trading":{"squareOffTime":"23:58"}}'
//   node scripts/dev-settings.mjs reset          (back to DEFAULT_SETTINGS)
//
// `getSettings()` merges the stored block over DEFAULT_SETTINGS, so a partial
// row is always safe to write — anything omitted keeps its default.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";

const [, , cmd, arg] = process.argv;
const db = new DatabaseSync("data/trade.db");

function stored() {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get("admin_settings");
  return row ? JSON.parse(String(row.v)) : null;
}

function write(obj) {
  db.prepare(
    "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  ).run("admin_settings", JSON.stringify(obj));
}

switch (cmd) {
  case "show": {
    const s = stored() || {};
    console.log(
      JSON.stringify(
        {
          marketHours: s.marketHours ?? "(default 09:15–15:30)",
          trading: s.trading ?? "(defaults)",
        },
        null,
        1,
      ),
    );
    break;
  }
  case "save": {
    if (!arg) throw new Error("usage: save <file>");
    writeFileSync(arg, JSON.stringify(stored() || {}, null, 1));
    console.log("saved ->", arg);
    break;
  }
  case "restore": {
    if (!arg) throw new Error("usage: restore <file>");
    write(JSON.parse(readFileSync(arg, "utf8")));
    console.log("restored <-", arg);
    break;
  }
  case "patch": {
    if (!arg) throw new Error("usage: patch '<json>'");
    const patch = JSON.parse(arg);
    const cur = stored() || {};
    const next = { ...cur };
    // Shallow-merge one level so `{"trading":{"x":1}}` keeps the other rules.
    for (const [k, v] of Object.entries(patch))
      next[k] =
        v && typeof v === "object" && !Array.isArray(v)
          ? { ...(cur[k] || {}), ...v }
          : v;
    write(next);
    console.log("patched:", JSON.stringify(patch));
    break;
  }
  case "reset": {
    db.prepare("DELETE FROM kv WHERE k = ?").run("admin_settings");
    console.log("reset to DEFAULT_SETTINGS");
    break;
  }
  default:
    console.log(
      "usage: dev-settings.mjs show|save <file>|restore <file>|patch '<json>'|reset",
    );
}
