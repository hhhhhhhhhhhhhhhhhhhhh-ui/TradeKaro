import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { codesInUse, generateClientCode } from "./clientCode";

// ── Central SQLite database ───────────────────────────────────────────────
// One atomic, crash-safe file (data/trade.db, WAL mode) behind every store:
// user accounts, watchlists, paper books, admin panel data, client registry.
// Node 24 ships node:sqlite — zero external dependencies, no server.

const FILE = path.join(process.cwd(), "data", "trade.db");
const g = globalThis as any;

// Bump whenever a table or index is added below. Next dev reuses the cached
// handle across hot reloads, so the revision check re-applies this idempotent
// DDL and new tables exist without restarting the server.
const SCHEMA_REV = 9;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      client_code TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_name ON users(lower(username));
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_mail ON users(lower(email));
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS legacy_books (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    -- Authoritative trading ledger. Append-only, written ONLY by the server
    -- after validating a fill against real market prices. Every score (realized
    -- P&L, win rate) is derived from here, so a tampered browser copy can never
    -- inflate a user's record. The legacy_books table above is now only a
    -- one-time import source for pre-SQLite books, and nothing writes it.
    CREATE TABLE IF NOT EXISTS trade_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      idem TEXT,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      value REAL NOT NULL,
      charges REAL NOT NULL,
      product TEXT,
      meta TEXT,
      source TEXT NOT NULL,
      ref_price REAL,
      ref_ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_trade_fills_user ON trade_fills(user_id, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_fills_idem
      ON trade_fills(user_id, idem) WHERE idem IS NOT NULL;
    -- Platform-wide analytics reads the ledger by time and by symbol, neither of
    -- which the (user_id, ts) index above can serve. Without these every
    -- analytics query is a full table scan.
    CREATE INDEX IF NOT EXISTS ix_trade_fills_ts ON trade_fills(ts);
    CREATE INDEX IF NOT EXISTS ix_trade_fills_symbol ON trade_fills(symbol);
    -- Rejected order attempts. The validator always returned a reason to the
    -- browser but never kept it, so "why do orders fail?" was unanswerable.
    CREATE TABLE IF NOT EXISTS trade_rejects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL,
      price REAL,
      status INTEGER,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_trade_rejects_at ON trade_rejects(at);
    CREATE INDEX IF NOT EXISTS ix_trade_rejects_reason
      ON trade_rejects(reason, at);
    -- Per-user seeded capital (starting cash at first use).
    CREATE TABLE IF NOT EXISTS trade_accounts (
      user_id TEXT PRIMARY KEY,
      start_cash REAL NOT NULL,
      seeded_at INTEGER NOT NULL
    );
    -- Money a user has actually funded. This is the ONLY number that counts
    -- toward the KYC deposit requirement, and it also raises trading capital:
    -- capital = trade_accounts.start_cash + SUM(amount). Append-only, and
    -- written only by the server — the user through POST /api/trade/deposit,
    -- an operator through POST /api/admin/clients. The browser never supplies
    -- a running total, so editing localStorage cannot buy KYC clearance.
    CREATE TABLE IF NOT EXISTS trade_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      actor TEXT,
      note TEXT,
      idem TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_trade_deposits_user
      ON trade_deposits(user_id, ts);
    -- Retry-safe: a double-clicked deposit carries the same idem and is ignored
    -- rather than credited twice.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_deposits_idem
      ON trade_deposits(user_id, idem) WHERE idem IS NOT NULL;
    -- Generic container for admin panel records (admin users, sessions,
    -- clients) — each row is one JSON blob keyed by kind + id.
    CREATE TABLE IF NOT EXISTS blocks (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      admin_id TEXT,
      email TEXT,
      action TEXT,
      detail TEXT,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_fails (
      k TEXT PRIMARY KEY,
      n INTEGER NOT NULL,
      first_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL
    );
    -- The audit log only ever grows and is read newest-first by the admin
    -- views; keep a timestamp index next to it.
    CREATE INDEX IF NOT EXISTS ix_audit_at ON audit(at);
    -- ── Payment gateway (Sunpays) ──────────────────────────────────────────
    -- One row per checkout we asked the gateway to create. We store our own
    -- order_id BEFORE we can know the outcome, because the webhook may arrive
    -- before the HTTP response that created it — a real race, not a theoretical
    -- one, and the row is what the callback matches against.
    CREATE TABLE IF NOT EXISTS payment_orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      method TEXT,
      status TEXT NOT NULL,
      txn_id TEXT,
      checkout_url TEXT,
      utr TEXT,
      raw TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_payment_orders_user
      ON payment_orders(user_id, created_at);
    -- Money out. Deliberately a separate table from pay-ins: separate key pair,
    -- separate lifecycle, separate failure modes, and an audit question that is
    -- always "what did we pay out" rather than "what did we take in".
    CREATE TABLE IF NOT EXISTS payment_payouts (
      payout_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL,
      net_amount REAL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      beneficiary_name TEXT,
      beneficiary_account TEXT,
      ifsc TEXT,
      bank_name TEXT,
      status TEXT NOT NULL,
      utr TEXT,
      actor TEXT,
      note TEXT,
      raw TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_payment_payouts_user
      ON payment_payouts(user_id, created_at);
    -- Every webhook delivery we see. The gateway retries up to 200 times, so
    -- duplicates are the normal case rather than an exception, and "have we
    -- already processed this?" has to be answerable from the database rather
    -- than from a variable that dies with the process.
    --
    -- The unique index is the idempotency guarantee itself: a repeat of the same
    -- transaction in the same state cannot be inserted twice. A genuinely new
    -- state (pending -> success) has a different key and is allowed through.
    CREATE TABLE IF NOT EXISTS payment_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      event TEXT NOT NULL,
      txn_id TEXT,
      ref_id TEXT,
      status TEXT,
      signature_ok INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      raw TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_webhooks_state
      ON payment_webhooks(txn_id, status) WHERE txn_id IS NOT NULL;
    -- ── Withdrawals ───────────────────────────────────────────────────────
    -- Where a customer wants money sent. Server-side on purpose: a payout must
    -- go to an account the SERVER knows about, because a beneficiary supplied
    -- by the browser at withdrawal time is exactly the value an attacker would
    -- want to control. This table is the replacement for the old device-only
    -- fs_bank_accounts list, which the operator would otherwise have to retype
    -- from a screenshot.
    CREATE TABLE IF NOT EXISTS payout_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      holder_name TEXT,
      upi_id TEXT,
      account_number TEXT,
      ifsc TEXT,
      bank_name TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_payout_accounts_user
      ON payout_accounts(user_id, created_at);
    -- The withdrawal ledger. One row per request, and it is the ONLY record of
    -- money leaving — which is what makes the balance honest, because
    -- deriveAccount subtracts the sum of everything not rejected or failed.
    --
    -- The id doubles as the gateway payout id, so approving twice cannot pay
    -- twice: the second attempt sees a status that is no longer requested.
    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net_amount REAL NOT NULL DEFAULT 0,
      account_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      payout_id TEXT,
      utr TEXT,
      requested_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_withdrawals_user
      ON withdrawals(user_id, requested_at);
    CREATE INDEX IF NOT EXISTS ix_withdrawals_status
      ON withdrawals(status, requested_at);
    CREATE INDEX IF NOT EXISTS ix_withdrawals_payout
      ON withdrawals(payout_id);
`;

// Columns added after the first release. `ALTER TABLE ADD COLUMN` is not
// idempotent, so check PRAGMA first — this runs once per process and after any
// SCHEMA_REV bump.
//
// The phone index lives here rather than in SCHEMA on purpose: an existing
// database has no `phone` column yet, so creating the index during
// `db.exec(SCHEMA)` would fail with "no such column: phone" and abort the whole
// schema — including table creation.
function ensureColumns(db: DatabaseSync) {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as any[]).map((c) =>
      String(c.name),
    ),
  );
  if (!cols.has("phone")) db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  // Partial index: unset/blank numbers must not collide with each other, which
  // a plain UNIQUE index would do (empty strings compare equal).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone ON users(phone)
    WHERE phone IS NOT NULL AND phone <> ''`);

  // Display-only broker-style account number (TK267X9Q4). Separate from `id`,
  // which is the primary key AND the ledger key every fill is filed under.
  if (!cols.has("client_code"))
    db.exec("ALTER TABLE users ADD COLUMN client_code TEXT");
  // Partial for the same reason as the phone index: accounts created before
  // the backfill below have NULL, and NULL must not collide with NULL.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_users_client_code
    ON users(client_code) WHERE client_code IS NOT NULL AND client_code <> ''`);
  backfillClientCodes(db);
}

/**
 * Give every pre-existing account a client code.
 *
 * Lazy rather than a one-off script: it runs on boot, is a single no-op SELECT
 * once everything has a code, and cannot be forgotten during a deploy. The year
 * comes from the account's own signup date, so a backfilled code still reads as
 * a true opening year instead of the day you happened to upgrade.
 */
function backfillClientCodes(db: DatabaseSync) {
  const missing = db
    .prepare(
      "SELECT id, created_at FROM users WHERE client_code IS NULL OR client_code = ''",
    )
    .all() as { id: string; created_at: number }[];
  if (!missing.length) return;

  const taken = codesInUse(
    db
      .prepare(
        "SELECT client_code FROM users WHERE client_code IS NOT NULL AND client_code <> ''",
      )
      .all() as { client_code: string }[],
  );

  const set = db.prepare("UPDATE users SET client_code = ? WHERE id = ?");
  for (const u of missing) {
    const year = new Date(Number(u.created_at) || Date.now()).getUTCFullYear();
    const code = generateClientCode(year, taken);
    taken.add(code);
    set.run(code, u.id);
  }
  console.log(
    `[db] assigned client codes to ${missing.length} existing account(s)`,
  );
}

function open(): DatabaseSync {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const db = new DatabaseSync(FILE);

  // ⚠️ `PRAGMA journal_mode = WAL` is unlike every other statement here: it
  // needs a brief EXCLUSIVE lock and does NOT honour busy_timeout. When several
  // processes open this file at the same moment — which is exactly what a Next
  // build does, since it evaluates this module in every worker — one of them
  // gets `database is locked` and the whole build fails with it. (That is the
  // intermittent "Failed to collect configuration for /api/admin/clients"
  // error: the stack points at this line.)
  //
  // The mode is persistent once set, so there is nothing to do on an
  // established database. Only attempt the change when it is not already WAL,
  // and never let the attempt be fatal — another process having set it first is
  // precisely the outcome we wanted.
  const mode = String(
    (db.prepare("PRAGMA journal_mode").get() as any)?.journal_mode || "",
  ).toLowerCase();
  if (mode !== "wal") {
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } catch {
      /* another connection got there first — good enough */
    }
  }

  db.exec("PRAGMA busy_timeout = 5000");
  // MUST run before SCHEMA: SCHEMA would otherwise create empty trade_* tables
  // beside the populated paper_* ones and the rename below would be skipped,
  // leaving every existing account looking brand new.
  renameLedgerTables(db);
  db.exec(SCHEMA);
  ensureColumns(db);
  importLegacy(db);
  return db;
}

// One-time rename of the original paper_* tables to trade_*. Idempotent: it
// only acts when the old name is present and the new one is not, so it is safe
// to call on every boot — including on a brand-new database, where it no-ops.
function renameLedgerTables(db: DatabaseSync) {
  const RENAMES: [string, string][] = [
    ["paper_fills", "trade_fills"],
    ["paper_accounts", "trade_accounts"],
    ["paper_deposits", "trade_deposits"],
    ["paper_rejects", "trade_rejects"],
    ["paper_books", "legacy_books"],
  ];
  // Index names are separate objects: SQLite keeps them (pointing at the
  // renamed table) but does not rename them, so drop the old ones and let
  // SCHEMA recreate them under the new names.
  const OLD_INDEXES = [
    "ix_paper_fills_user",
    "ux_paper_fills_idem",
    "ix_paper_fills_ts",
    "ix_paper_fills_symbol",
    "ix_paper_rejects_at",
    "ix_paper_rejects_reason",
    "ix_paper_deposits_user",
    "ux_paper_deposits_idem",
  ];

  let has = (name: string) =>
    Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    );

  for (const [from, to] of RENAMES) {
    if (!has(from)) continue;
    if (!has(to)) {
      db.exec(`ALTER TABLE "${from}" RENAME TO "${to}"`);
      continue;
    }
    // Both exist — a previous run stopped halfway. Move any rows across rather
    // than leaving data stranded, but never overwrite what is already there.
    const oldRows = db.prepare(`SELECT COUNT(*) n FROM "${from}"`).get() as any;
    const newRows = db.prepare(`SELECT COUNT(*) n FROM "${to}"`).get() as any;
    if (Number(oldRows?.n) > 0 && Number(newRows?.n) === 0) {
      db.exec(`INSERT INTO "${to}" SELECT * FROM "${from}"`);
      db.exec(`DROP TABLE "${from}"`);
    }
  }

  for (const ix of OLD_INDEXES) {
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?")
        .get(ix)
    )
      db.exec(`DROP INDEX "${ix}"`);
  }

  // The renamed tables keep whatever they had; make sure the two non-PK
  // indexes that make analytics usable exist before anything queries them.
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS ix_trade_fills_user ON trade_fills(user_id, ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_fills_idem ON trade_fills(user_id, idem) WHERE idem IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_trade_fills_ts ON trade_fills(ts)",
    "CREATE INDEX IF NOT EXISTS ix_trade_fills_symbol ON trade_fills(symbol)",
    "CREATE INDEX IF NOT EXISTS ix_trade_rejects_at ON trade_rejects(at)",
    "CREATE INDEX IF NOT EXISTS ix_trade_rejects_reason ON trade_rejects(reason, at)",
    "CREATE INDEX IF NOT EXISTS ix_trade_deposits_user ON trade_deposits(user_id, ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_deposits_idem ON trade_deposits(user_id, idem) WHERE idem IS NOT NULL",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* the table may not exist yet on a fresh database — SCHEMA creates both */
    }
  }
}

// One-time import of the pre-SQLite JSON files. Guarded by a kv flag so it
// runs exactly once; the original files stay on disk as a backup.
function importLegacy(db: DatabaseSync) {
  const done = db.prepare("SELECT v FROM kv WHERE k = 'migrated_v1'").get();
  if (done) return;
  const root = path.join(process.cwd(), "data");
  const readJson = (p: string): any | null => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };

  // Users + watchlists
  const users = readJson(path.join(root, "auth", "users.json"));
  if (Array.isArray(users)) {
    const insU = db.prepare(
      "INSERT OR IGNORE INTO users (id, username, email, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?)",
    );
    const insW = db.prepare(
      "INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?,?,?)",
    );
    for (const u of users) {
      if (!u?.id || !u?.username) continue;
      insU.run(
        String(u.id),
        String(u.username),
        String(u.email || ""),
        String(u.passHash || ""),
        String(u.salt || ""),
        Number(u.createdAt) || Date.now(),
      );
      const wl: unknown[] = Array.isArray(u.watchlist) ? u.watchlist : [];
      wl.forEach((s, i) =>
        insW.run(String(u.id), String(s).toUpperCase(), Date.now() + i),
      );
    }
  }

  // Paper books (u-<id>.json files)
  try {
    const dir = path.join(root, "paper");
    const insB = db.prepare(
      "INSERT OR REPLACE INTO legacy_books (key, json, at) VALUES (?,?,?)",
    );
    for (const f of readdirSync(dir)) {
      if (!f.startsWith("u-") || !f.endsWith(".json")) continue;
      try {
        insB.run(
          f.replace(/\.json$/, ""),
          readFileSync(path.join(dir, f), "utf8"),
          Date.now(),
        );
      } catch {
        /* skip unreadable file */
      }
    }
  } catch {
    /* no paper dir */
  }

  // Admin panel blocks (users, sessions, clients)
  const block = (kind: string, file: string, idOf: (x: any) => string) => {
    const arr = readJson(file);
    if (!Array.isArray(arr)) return;
    const ins = db.prepare(
      "INSERT OR REPLACE INTO blocks (kind, id, json, at) VALUES (?,?,?,?)",
    );
    for (const item of arr) {
      const id = idOf(item);
      if (!id) continue;
      ins.run(kind, id, JSON.stringify(item), Date.now());
    }
  };
  block("admin_users", path.join(root, "admin", "users.json"), (u) => u?.id);
  block(
    "admin_sessions",
    path.join(root, "admin", "sessions.json"),
    (s) => s?.token,
  );
  block("client", path.join(root, "admin", "clients.json"), (c) => c?.id);

  // Settings blob
  const settings = readJson(path.join(root, "admin", "settings.json"));
  if (settings && typeof settings === "object") {
    db.prepare(
      "INSERT OR REPLACE INTO kv (k, v) VALUES ('admin_settings', ?)",
    ).run(JSON.stringify(settings));
  }

  // Audit log (JSONL)
  try {
    const lines = readFileSync(path.join(root, "admin", "audit.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
    const ins = db.prepare(
      "INSERT INTO audit (at, admin_id, email, action, detail, ip) VALUES (?,?,?,?,?,?)",
    );
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        ins.run(
          Number(e.at) || 0,
          String(e.adminId || ""),
          String(e.email || ""),
          String(e.action || ""),
          String(e.detail || ""),
          String(e.ip || ""),
        );
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no audit file */
  }

  db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('migrated_v1', ?)").run(
    String(Date.now()),
  );
}

// Single shared connection per process (survives Next dev hot reloads).
function connect(): DatabaseSync {
  const cached = g.__fsDb as DatabaseSync | undefined;
  if (cached) {
    if (g.__fsDbRev !== SCHEMA_REV) {
      cached.exec(SCHEMA);
      g.__fsDbRev = SCHEMA_REV;
    }
    ensureColumns(cached);
    return cached;
  }
  const fresh = open();
  g.__fsDb = fresh;
  g.__fsDbRev = SCHEMA_REV;
  return fresh;
}

export const db: DatabaseSync = connect();

// Small helpers used by the stores.
export function kvGet(key: string): string | null {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(key) as any;
  return row ? String(row.v) : null;
}

export function kvSet(key: string, value: string) {
  db.prepare(
    "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  ).run(key, value);
}
