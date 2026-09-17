// Inspect the central SQLite database: node scripts/db-info.mjs
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "trade.db"));
const count = (sql) => db.prepare(sql).get().n;

console.log("\n══ data/trade.db\n");
console.log("users            :", count("SELECT COUNT(*) n FROM users"));
console.log("watchlist rows   :", count("SELECT COUNT(*) n FROM watchlist"));
console.log("legacy books     :", count("SELECT COUNT(*) n FROM legacy_books"));
console.log(
  "admin users      :",
  count("SELECT COUNT(*) n FROM blocks WHERE kind='admin_users'"),
);
console.log(
  "admin sessions   :",
  count("SELECT COUNT(*) n FROM blocks WHERE kind='admin_sessions'"),
);
console.log(
  "tracked clients  :",
  count("SELECT COUNT(*) n FROM blocks WHERE kind='client'"),
);
console.log("audit entries    :", count("SELECT COUNT(*) n FROM audit"));
console.log(
  "kv keys          :",
  db
    .prepare("SELECT k FROM kv")
    .all()
    .map((r) => r.k)
    .join(", "),
);

console.log("\nusers:");
for (const u of db
  .prepare(
    "SELECT id, username, email, created_at FROM users ORDER BY created_at",
  )
  .all())
  console.log(
    "  ",
    u.username,
    "·",
    u.email,
    "·",
    new Date(Number(u.created_at)).toLocaleDateString(),
  );

const s = db.prepare("SELECT v FROM kv WHERE k='admin_settings'").get();
if (s) {
  const cfg = JSON.parse(String(s.v));
  console.log("\nsettings import check:");
  console.log(
    "   providerOff:",
    cfg.providerOff,
    "· maintenance:",
    cfg.maintenance,
  );
  console.log(
    "   startCash  :",
    cfg.trading?.startCash,
    "· maxQty:",
    cfg.trading?.maxQty,
  );
  console.log(
    "   marketHours:",
    cfg.marketHours?.open,
    "-",
    cfg.marketHours?.close,
  );
}
console.log();
