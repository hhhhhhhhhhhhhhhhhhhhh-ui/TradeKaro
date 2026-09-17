// Daily backup: checkpoint the SQLite WAL, zip the data, rotate old copies.
//   node scripts/backup.mjs                → make a backup now
//   node scripts/backup.mjs --install-task → also schedule it daily at 18:00
//
// Backups land in ./backups/ (gitignored) as trade-backup-YYYY-MM-DD-HHmm.zip
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB = path.join(ROOT, "data", "trade.db");
const OUT = path.join(ROOT, "backups");
const KEEP = Number(process.env.KEEP || 30);

mkdirSync(OUT, { recursive: true });

// 1) Flush the write-ahead log into the main file so the copy is complete.
let counts = {};
if (existsSync(DB)) {
  try {
    const db = new DatabaseSync(DB);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    // Every table that holds data worth restoring. The trade_* ledger was
    // missing from this list, so a backup of a live platform recorded nothing
    // about fills, balances or deposits.
    const TABLES = [
      "users",
      "watchlist",
      "trade_fills",
      "trade_accounts",
      "trade_deposits",
      "trade_rejects",
      "legacy_books",
      "blocks",
      "audit",
    ];
    for (const t of TABLES) {
      try {
        counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
      } catch {
        /* table may not exist yet */
      }
    }
    db.close();
  } catch (e) {
    console.warn("checkpoint warning:", e.message);
  }
}

// 2) Manifest — makes a restore verifiable at a glance.
const manifestPath = path.join(ROOT, "data", "backup-manifest.json");
writeFileSync(
  manifestPath,
  JSON.stringify({ at: new Date().toISOString(), counts }, null, 2),
);

// 3) Zip data (db + wal/shm if present + secret + manifest + legacy archive).
const items = [
  "data/trade.db",
  "data/trade.db-wal",
  "data/trade.db-shm",
  "data/auth/secret",
  "data/backup-manifest.json",
  "data/_legacy_json_backup",
]
  .map((p) => path.join(ROOT, p))
  .filter((p) => existsSync(p));

const stamp = new Date()
  .toISOString()
  .replace("T", "-")
  .replace(/[:]/g, "")
  .slice(0, 15);
const zip = path.join(OUT, `trade-backup-${stamp}.zip`);

const list = items.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
const ps = `Compress-Archive -Path ${list} -DestinationPath '${zip.replace(/'/g, "''")}' -Force`;
const zipRun = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
  encoding: "utf8",
});
if (zipRun.status !== 0) {
  console.error("zip failed:", zipRun.stderr || zipRun.stdout);
  process.exit(1);
}
const kb = Math.round(statSync(zip).size / 1024);

// 4) Rotation — keep the newest KEEP archives.
const zips = readdirSync(OUT)
  .filter((f) => f.startsWith("trade-backup-") && f.endsWith(".zip"))
  .sort();
const drop = zips.slice(0, Math.max(0, zips.length - KEEP));
for (const f of drop) unlinkSync(path.join(OUT, f));

console.log(`backup written: backups/${path.basename(zip)} (${kb} KB)`);
console.log(
  `rows: ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`,
);
console.log(
  `rotation: ${zips.length - drop.length} kept, ${drop.length} removed (keep ${KEEP})`,
);

// 5) Optional: schedule it daily at 18:00 (well after market close).
if (process.argv.includes("--install-task")) {
  const node = process.execPath;
  const script = path.join(ROOT, "scripts", "backup.mjs");
  const cmd = `"${node}" "${script}"`;
  const r = spawnSync(
    "schtasks",
    [
      "/Create",
      "/TN",
      "FoursightBackup",
      "/TR",
      cmd,
      "/SC",
      "DAILY",
      "/ST",
      "18:00",
      "/F",
    ],
    { encoding: "utf8" },
  );
  if (r.status === 0) console.log("scheduled: FoursightBackup daily at 18:00");
  else {
    console.log(
      "could not create the scheduled task automatically. Run this once in an elevated shell:",
    );
    console.log(
      `  schtasks /Create /TN FoursightBackup /TR "${cmd}" /SC DAILY /ST 18:00 /F`,
    );
    if (r.stderr) console.log(String(r.stderr).trim().split("\n")[0]);
  }
}
