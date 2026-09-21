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
const SCHEMA_REV = 20;

// Bump whenever ANY landing-page copy in seedAffiliates() changes. This is what
// makes new wording reach a database that already has the rows — `INSERT OR
// IGNORE` alone only ever seeds a brand-new database.
const LANDING_COPY_REV = 2;

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

    -- ── affiliates / partners ────────────────────────────────────────────────
    --
    -- A DELIBERATELY SEPARATE identity store from the users table. An affiliate
    -- is not a trader and must never be one by accident: different table,
    -- different cookie (partner_token), different signing key. A partner token
    -- cannot open a trader session and a trader token cannot open a partner
    -- session, because they are not even signed with the same key.
    CREATE TABLE IF NOT EXISTS affiliates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      company TEXT,
      website TEXT,
      audience TEXT,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      /** pending | approved | rejected | suspended */
      status TEXT NOT NULL DEFAULT 'pending',
      plan_id TEXT,
      /** Per-affiliate override of the plan; null means "use the plan". */
      model TEXT,
      deposit_rate REAL,
      rev_rate REAL,
      note TEXT,
      reject_reason TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      login_count INTEGER NOT NULL DEFAULT 0,
      last_login INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_affiliates_email
      ON affiliates(lower(email));
    CREATE UNIQUE INDEX IF NOT EXISTS ux_affiliates_code
      ON affiliates(code);
    CREATE INDEX IF NOT EXISTS ix_affiliates_status
      ON affiliates(status, created_at);

    -- One row per landing page click. Written server-side when the page renders,
    -- because a cookie alone is both clearable and forgeable.
    --
    -- day and device exist so a partner refreshing their own link does not
    -- inflate their click count. Every page load still writes a row (the raw
    -- number is worth keeping), but only the first from one device in one day is
    -- flagged is_unique, and it is that pair the panel reports. Without this a
    -- partner testing their link ten times saw ten clicks and no signups, which
    -- reads as "my traffic is terrible" when it is their own browser.
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      ts INTEGER NOT NULL,
      ip TEXT,
      ua TEXT,
      landing TEXT,
      campaign TEXT,
      referer TEXT,
      /** YYYY-MM-DD in UTC — the bucket a device is made unique within. */
      day TEXT,
      /** Short hash of ip + user agent. Never a raw fingerprint. */
      device TEXT,
      /** 1 for the first click from this device on this day, else 0. */
      is_unique INTEGER NOT NULL DEFAULT 1,
      /** Set when this click turned into an account. */
      user_id TEXT,
      /**
       * JSON bag of the ad click ids and campaign params captured at first
       * touch — fbclid, gclid, wbraid, msclkid, utm_*. A bag rather than a
       * column per provider because ad platforms keep inventing new identifiers
       * (ttclid, twclid, li_fat_id…) and each one must not cost a migration.
       * Written once, read once at Conversion-API dispatch time. If reporting
       * ever needs to group by one, SQLite's json_extract covers it.
       */
      signals TEXT,
      /**
       * Where this visitor stands on cookie consent, from their jurisdiction:
       * 'exempt' when no banner was owed, 'granted'/'denied' once they answered
       * it, NULL when they were asked and have not chosen yet.
       *
       * Conversion API forwarding reads this. NULL must be treated as "may not
       * forward" — an unanswered banner is not permission.
       */
      consent TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_aff_clicks_code ON affiliate_clicks(code, ts);

    -- Every conversion-grade event, recorded server-side before anything is
    -- sent to an ad platform.
    --
    -- This is an OUTBOX, not a log. A row is written in the same moment as the
    -- thing that happened (the account, the deposit), and Phase 4 dispatches it
    -- to Meta and Google afterwards. Writing it first is what makes the
    -- guarantee possible: if Meta is slow or down, the signup still succeeds and
    -- the event is still delivered later. A fire-and-forget call to an ad
    -- network would lose the event and there would be no record it existed.
    --
    -- event_id is derived from the domain entity (signup:<userId>,
    -- deposit:<rowId>), never random, so the browser pixel and the server send
    -- the SAME id and the platforms collapse them into one conversion. UNIQUE is
    -- what makes a retried webhook or a refreshed page harmless.
    --
    -- NOTE: SQL comments here, not JS ones, and no backticks anywhere in this
    -- literal — a backtick terminates the template and the error it produces
    -- (TS1005, several lines away) points at the wrong place entirely.
    CREATE TABLE IF NOT EXISTS conversion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      -- Canonical name — see lib/trackingEvents.ts.
      name TEXT NOT NULL,
      user_id TEXT,
      -- Copied from the bound click so the affiliate is not re-derived later.
      affiliate_code TEXT,
      -- affiliate_clicks.id — the click these were bought with.
      click_id INTEGER,
      value REAL,
      currency TEXT,
      -- granted | denied | exempt | unknown. NULL must be read as do-not-send.
      consent TEXT,
      -- GA4 will not attribute without a client_id.
      ga_client_id TEXT,
      -- The visitor's own ip and user agent at the moment of the event.
      --
      -- Meta matches better with them, and a conversion from organic traffic
      -- has no affiliate click to borrow them from — which is most of them. Only
      -- ever set from a request the visitor actually made: the ip on a payment
      -- webhook is the GATEWAY's, and sending it would be worse than sending
      -- nothing, because it would confidently match the wrong person.
      client_ip TEXT,
      client_ua TEXT,
      occurred_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      -- Filled by the Phase 4 dispatcher. NULL means still owed.
      dispatched_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_conv_pending
      ON conversion_events(dispatched_at, occurred_at);

    -- One row per (event, provider): what has been sent where, and what is owed.
    --
    -- Split from conversion_events because the two providers fail
    -- independently. Meta succeeding while GA4 retries is the normal case, and a
    -- single status column on the event could only record one of them — so the
    -- other would be either resent or silently dropped.
    --
    -- status: pending | sent | failed | skipped. failed and skipped are
    -- terminal; skipped means we CHOSE not to send (no consent), which is a
    -- different thing from being unable to and is worth telling apart when
    -- someone asks why a conversion never showed up.
    CREATE TABLE IF NOT EXISTS conversion_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      response TEXT,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      UNIQUE(event_id, provider)
    );
    CREATE INDEX IF NOT EXISTS ix_deliv_due
      ON conversion_deliveries(status, next_attempt_at);

    -- A partner's own tracking pixels.
    --
    -- These belong to the PARTNER, not to us. They are a credential they handed
    -- over so we can report conversions to their own ad account, and they are
    -- encrypted at rest for that reason — see lib/pixelCrypto.ts.
    --
    -- pixel_id is rendered into a script tag on our origin and is therefore
    -- attacker-controlled input. It is validated against a strict shape at the
    -- only write path (lib/pixels.ts) and must never be stored, or emitted,
    -- without that validation having run.
    --
    -- UNIQUE(affiliate_id, provider): one pixel per provider per partner. A
    -- second Meta pixel would raise the question of which one gets the
    -- conversion, and there is no good answer to that.
    CREATE TABLE IF NOT EXISTS tracking_pixels (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      pixel_id TEXT NOT NULL,
      -- AES-256-GCM blob, or NULL for a browser-only pixel.
      token_enc TEXT,
      label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(affiliate_id, provider)
    );
    CREATE INDEX IF NOT EXISTS ix_pixels_aff
      ON tracking_pixels(affiliate_id, provider);
    -- NOTE: the (code, day, device) index is deliberately NOT created here.
    -- day and device are migration columns, so on a database that predates
    -- SCHEMA_REV 11 the CREATE TABLE above is a no-op and the columns do not
    -- exist yet. Creating the index here would abort the whole schema exec with
    -- "no such column: day" *before* ensureColumns() ever got a chance to add
    -- them — taking the entire app down, not just this one index. ensureColumns()
    -- creates it after the ALTERs instead.

    -- Things a partner has asked us for. Deliberately small: one row per
    -- request, decided by an operator in the console. Replaces a mailto link
    -- that left the panel and needed a configured mail client to work at all.
    CREATE TABLE IF NOT EXISTS affiliate_requests (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      /** landing_page | creative | other */
      kind TEXT NOT NULL DEFAULT 'landing_page',
      title TEXT NOT NULL,
      detail TEXT,
      audience TEXT,
      /** open | done | declined */
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_aff_requests_aff
      ON affiliate_requests(affiliate_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_aff_requests_status
      ON affiliate_requests(status, created_at);

    -- The permanent, one-time binding: one customer belongs to one affiliate.
    CREATE TABLE IF NOT EXISTS affiliate_referrals (
      user_id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      code TEXT NOT NULL,
      landing TEXT,
      campaign TEXT,
      /** Real money verified from this customer, in paise-free rupees. */
      deposited REAL NOT NULL DEFAULT 0,
      /** Reversed commission, kept visible rather than deleted. */
      reversed REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_aff_refs_aff
      ON affiliate_referrals(affiliate_id, created_at);

    CREATE TABLE IF NOT EXISTS affiliate_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      /** deposit | revshare | hybrid */
      model TEXT NOT NULL,
      deposit_rate REAL NOT NULL DEFAULT 0,
      rev_rate REAL NOT NULL DEFAULT 0,
      /** Days a commission waits before it can be approved. */
      hold_days INTEGER NOT NULL DEFAULT 21,
      min_payout REAL NOT NULL DEFAULT 1000,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    -- The commission ledger. Money is never paid from a deposit alone: a row is
    -- created pending, becomes approvable after the holdback, and only then can
    -- be paid. A customer who withdraws it back reverses the row instead.
    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id TEXT NOT NULL,
      user_id TEXT,
      /** Which deposit (or other event) produced this. */
      source TEXT,
      idem TEXT,
      base_amount REAL NOT NULL DEFAULT 0,
      rate REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      /** pending | approved | paid | reversed */
      status TEXT NOT NULL DEFAULT 'pending',
      hold_until INTEGER,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      note TEXT,
      /**
       * The terms this commission was actually earned under, snapshotted at the
       * moment of the deposit.
       *
       * These exist because the alternative is unanswerable. Reading the live
       * rate and holdback at payout time means "why is this number this number"
       * has no answer once a rate changes, and a partner who asks gets a
       * shrug. With these, every row explains itself forever.
       */
      model TEXT,
      plan_id TEXT,
      hold_days INTEGER,
      /** The trade_deposits row that produced it, so the money can be traced. */
      deposit_id INTEGER,
      /**
       * When the money ARRIVED, which is not when the row was written.
       *
       * A commission created by the reconciliation repair is written today for
       * a deposit made in March; dating it today would put it in the wrong
       * month on every chart and in the wrong holdback window.
       */
      earned_at INTEGER,
      /** 1 when the row was created by reconciliation rather than live. */
      reconciled INTEGER NOT NULL DEFAULT 0
    );

    -- Append-only record of the commercial terms an affiliate was on, and when.
    --
    -- "What was this partner's rate on 3 June" is a question that WILL be
    -- asked, by a partner disputing a number or by us reconciling one. Without
    -- this the only answer is today's rate, applied to yesterday's money.
    CREATE TABLE IF NOT EXISTS affiliate_terms_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id TEXT NOT NULL,
      /** When these terms took effect. */
      at INTEGER NOT NULL,
      model TEXT,
      deposit_rate REAL,
      rev_rate REAL,
      hold_days INTEGER,
      min_payout REAL,
      plan_id TEXT,
      /** Who changed them, and why. Free text, for humans. */
      actor TEXT,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_aff_terms_aff
      ON affiliate_terms_history(affiliate_id, at);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_aff_comm_idem
      ON affiliate_commissions(idem) WHERE idem IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ix_aff_comm_aff
      ON affiliate_commissions(affiliate_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_aff_comm_status
      ON affiliate_commissions(status, hold_until);

    CREATE TABLE IF NOT EXISTS affiliate_payout_accounts (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      /** upi | bank | usdt */
      kind TEXT NOT NULL,
      label TEXT,
      holder TEXT,
      upi_id TEXT,
      account_tail TEXT,
      ifsc TEXT,
      bank_name TEXT,
      usdt_address TEXT,
      usdt_network TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_aff_acct_aff
      ON affiliate_payout_accounts(affiliate_id, created_at);

    -- Payouts are REQUESTED by the partner and sent BY HAND by an operator.
    -- There is deliberately no payout API integration: a crypto or UPI transfer
    -- is irreversible, so a human approves the destination before money moves.
    CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      amount REAL NOT NULL,
      /** upi | bank | usdt */
      method TEXT NOT NULL,
      account_id TEXT,
      destination TEXT,
      /** requested | approved | paid | rejected */
      status TEXT NOT NULL DEFAULT 'requested',
      note TEXT,
      utr TEXT,
      requested_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_aff_payout_aff
      ON affiliate_payouts(affiliate_id, requested_at);
    CREATE INDEX IF NOT EXISTS ix_aff_payout_status
      ON affiliate_payouts(status, requested_at);

    -- Landing pages as DATA, so a new one can be published without a deploy.
    CREATE TABLE IF NOT EXISTS landing_pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      headline TEXT NOT NULL,
      subheadline TEXT,
      offer TEXT,
      cta TEXT,
      /** Which markets this page points at, e.g. "NSE · Options · Commodities" */
      tags TEXT,
      /**
       * JSON array of short selling points, e.g. ["Instant UPI top-up", ...].
       *
       * The page used to show the same three hardcoded product cards whatever
       * campaign the visitor arrived from, which made eight different landing
       * pages read identically. These are per-page and per-offer, rendered as a
       * ticked strip under the hero.
       */
      highlights TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
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

  // ── affiliate click de-duplication (SCHEMA_REV 11) ──
  //
  // Added after clicks had already been recorded, so an existing database needs
  // the columns bolted on. `is_unique` defaults to 1, which is the honest
  // answer for history: we cannot know whether two old rows were the same
  // device, and inventing 0 would silently halve a partner's reported traffic.
  const clickCols = new Set(
    (db.prepare("PRAGMA table_info(affiliate_clicks)").all() as any[]).map(
      (c) => String(c.name),
    ),
  );
  if (!clickCols.has("day"))
    db.exec("ALTER TABLE affiliate_clicks ADD COLUMN day TEXT");
  if (!clickCols.has("device"))
    db.exec("ALTER TABLE affiliate_clicks ADD COLUMN device TEXT");
  if (!clickCols.has("is_unique"))
    db.exec(
      "ALTER TABLE affiliate_clicks ADD COLUMN is_unique INTEGER NOT NULL DEFAULT 1",
    );
  // `day` is derivable from `ts`, so backfill it rather than leaving NULL —
  // otherwise every pre-migration row falls outside every day range and the
  // dashboard would show a gap in the chart that never happened.
  db.exec(`UPDATE affiliate_clicks
     SET day = strftime('%Y-%m-%d', ts / 1000, 'unixepoch')
     WHERE day IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS ix_aff_clicks_unique
    ON affiliate_clicks(code, day, device)`);

  // ── commission ledger snapshots (SCHEMA_REV 12) ──
  //
  // Same rule as above: these columns are added by migration, so any index over
  // them is created HERE, after the ALTERs, never in the SCHEMA literal.
  const commCols = new Set(
    (db.prepare("PRAGMA table_info(affiliate_commissions)").all() as any[]).map(
      (c) => String(c.name),
    ),
  );
  const addComm = (col: string, ddl: string) => {
    if (!commCols.has(col)) db.exec(`ALTER TABLE affiliate_commissions ${ddl}`);
  };
  addComm("model", "ADD COLUMN model TEXT");
  addComm("plan_id", "ADD COLUMN plan_id TEXT");
  addComm("hold_days", "ADD COLUMN hold_days INTEGER");
  addComm("deposit_id", "ADD COLUMN deposit_id INTEGER");
  addComm("earned_at", "ADD COLUMN earned_at INTEGER");
  addComm("reconciled", "ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0");
  // Reconciliation has to find a customer's commissions by user, which no
  // existing index covers — `ix_aff_comm_aff` is keyed on the affiliate.
  db.exec(
    "CREATE INDEX IF NOT EXISTS ix_aff_comm_user ON affiliate_commissions(user_id)",
  );
  // Backfill `earned_at` from `created_at`. It is the best available estimate,
  // and for every row written before this revision the two really were the same
  // moment. A NULL here would exclude the row from holdback and month buckets.
  db.exec(
    "UPDATE affiliate_commissions SET earned_at = created_at WHERE earned_at IS NULL",
  );

  // Give every affiliate that predates the terms history a starting row, dated
  // to when they joined.
  //
  // This resolves the rate the same way `shape()` does — a NULL per-affiliate
  // override means "inherit the plan" — so the backfilled terms say exactly what
  // was in force. It is still an assumption for anyone whose rate changed before
  // this revision, and `reconcileCommissions` reports any row it has to resolve
  // this way rather than quietly trusting it.
  db.exec(`INSERT INTO affiliate_terms_history
      (affiliate_id, at, model, deposit_rate, rev_rate, hold_days, min_payout,
       plan_id, actor, reason)
    SELECT a.id, a.created_at,
           COALESCE(a.model, p.model, 'deposit'),
           COALESCE(a.deposit_rate, p.deposit_rate, 0),
           COALESCE(a.rev_rate, p.rev_rate, 0),
           COALESCE(p.hold_days, 21),
           COALESCE(p.min_payout, 1000),
           a.plan_id, 'system',
           'backfilled at schema rev 12 from the terms on file'
      FROM affiliates a
      LEFT JOIN affiliate_plans p ON p.id = a.plan_id
     WHERE NOT EXISTS (
       SELECT 1 FROM affiliate_terms_history t WHERE t.affiliate_id = a.id)`);

  // ── remove the unimplemented CPA field (SCHEMA_REV 13) ──
  //
  // `cpa_amount` was on both `affiliates` and `affiliate_plans`, written by the
  // plan seeder and read into a type — but nothing ever turned a signup or a
  // deposit into a CPA commission. A plan advertising one therefore silently
  // paid only its deposit/revshare rates: a promise the engine did not keep.
  //
  // Removed rather than implemented, because a half-built payout rule is worse
  // than an absent one. Nothing reads the column any more, so if the drop fails
  // on an old SQLite the column simply sits there harmlessly — it must never be
  // able to abort the schema exec and take the app down.
  const dropIfPresent = (table: string, col: string) => {
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) =>
        String(c.name),
      ),
    );
    if (!cols.has(col)) return;
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
    } catch {
      console.warn(
        `[db] could not drop ${table}.${col} — unused, so harmless to leave.`,
      );
    }
  };
  dropIfPresent("affiliates", "cpa_amount");
  dropIfPresent("affiliate_plans", "cpa_amount");

  // ── landing page highlights (SCHEMA_REV 14) ──
  //
  // Migration column, so it is added here rather than relied on from SCHEMA.
  const pageCols = new Set(
    (db.prepare("PRAGMA table_info(landing_pages)").all() as any[]).map((c) =>
      String(c.name),
    ),
  );
  if (!pageCols.has("highlights"))
    db.exec("ALTER TABLE landing_pages ADD COLUMN highlights TEXT");

  // ── ad click ids on a click (SCHEMA_REV 15) ──
  //
  // Migration column, so it is added here rather than relied on from SCHEMA —
  // on an existing database the CREATE TABLE above is a no-op and the column
  // would never appear.
  //
  // Deliberately no index. Nothing queries by this column: it is written with
  // the click and read back by the row's own primary key when a conversion is
  // dispatched. An index here would be pure write cost on the hottest insert in
  // the affiliate system.
  //
  // Re-read the column list rather than reusing `clickCols` from the SCHEMA_REV
  // 11 block above: that snapshot was taken before this function's own ALTERs
  // ran, so it is a stale view and reusing it would re-issue an ALTER every boot.
  const adCols = new Set(
    (db.prepare("PRAGMA table_info(affiliate_clicks)").all() as any[]).map(
      (c) => String(c.name),
    ),
  );
  if (!adCols.has("signals"))
    db.exec("ALTER TABLE affiliate_clicks ADD COLUMN signals TEXT");

  // ── consent per click (SCHEMA_REV 16) ──
  //
  // Same migration-column rule as above. No index: read back by primary key at
  // conversion dispatch, never filtered on.
  if (!adCols.has("consent"))
    db.exec("ALTER TABLE affiliate_clicks ADD COLUMN consent TEXT");

  // ── GA4 client id on a conversion event (SCHEMA_REV 18) ──
  //
  // Migration column, so it is added here rather than relied on from SCHEMA.
  // GA4 will not attribute an event without a client_id, and a deposit arrives
  // on a webhook with no browser attached, so this has to be captured at signup
  // and carried.
  const convCols = new Set(
    (db.prepare("PRAGMA table_info(conversion_events)").all() as any[]).map(
      (c) => String(c.name),
    ),
  );
  if (!convCols.has("ga_client_id"))
    db.exec("ALTER TABLE conversion_events ADD COLUMN ga_client_id TEXT");
  if (!convCols.has("client_ip"))
    db.exec("ALTER TABLE conversion_events ADD COLUMN client_ip TEXT");
  if (!convCols.has("client_ua"))
    db.exec("ALTER TABLE conversion_events ADD COLUMN client_ua TEXT");

  // A partner must never have two open payout requests at once. `requestPayout`
  // checks this in code, but a check-then-insert is not atomic: two requests
  // arriving together can both pass the check and both be written, letting the
  // same balance be paid twice. This makes it impossible rather than unlikely.
  //
  // Created defensively. If a database already contains duplicates the CREATE
  // fails, and a unhandled failure here would abort the whole schema exec and
  // take the app down — the exact class of outage this file has suffered
  // before. A missing index degrades a guarantee; a thrown error stops trading.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_aff_payout_open
      ON affiliate_payouts(affiliate_id)
      WHERE status IN ('requested','approved')`);
  } catch {
    console.warn(
      "[db] ux_aff_payout_open not created — duplicate open payouts already exist. " +
        "Resolve them, then restart to get the double-spend guard.",
    );
  }
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

  // ⚠️ FIRST, before anything else touches the file. Every statement below can
  // find the database momentarily locked, because a Next build evaluates this
  // module in several workers at once. With no busy_timeout set, SQLite returns
  // SQLITE_BUSY immediately instead of waiting, and the error surfaces as
  // "database is locked" from whichever line happened to be first.
  //
  // This has to precede the journal_mode work, not follow it: an earlier version
  // of this function set the timeout second and read journal_mode first, so the
  // read — a plain read, which in WAL mode can still need a lock to recover the
  // shared index — was the statement that failed.
  db.exec("PRAGMA busy_timeout = 5000");

  // ⚠️ `PRAGMA journal_mode = WAL` is unlike every other statement here: it
  // needs a brief EXCLUSIVE lock and does NOT honour busy_timeout. When several
  // processes open this file at the same moment — which is exactly what a Next
  // build does — one of them gets `database is locked` and the whole build dies
  // with it. (That was the intermittent "Failed to collect configuration for
  // /api/admin/clients" error.)
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
  // MUST run before SCHEMA: SCHEMA would otherwise create empty trade_* tables
  // beside the populated paper_* ones and the rename below would be skipped,
  // leaving every existing account looking brand new.
  renameLedgerTables(db);
  db.exec(SCHEMA);
  ensureColumns(db);
  seedAffiliates(db);
  importLegacy(db);
  return db;
}

// Starter commission plans and landing pages. Idempotent — every insert is an
// `INSERT OR IGNORE` guarded by an explicit id, so an operator renaming or
// re-pricing a plan later is never overwritten on the next boot.
function seedAffiliates(db: DatabaseSync) {
  const now = Date.now();
  const plans: [string, string, string, number, number, number, number][] = [
    // id, name, model, deposit %, rev %, hold days, min payout ₹
    ["pl-std", "Standard", "deposit", 20, 0, 21, 1000],
    ["pl-pro", "Pro Partner", "hybrid", 30, 15, 21, 2000],
    ["pl-rev", "Revenue Share", "revshare", 0, 35, 30, 2500],
  ];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO affiliate_plans
       (id, name, model, deposit_rate, rev_rate, hold_days, min_payout, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  for (const [id, name, model, dr, rr, hold, min] of plans)
    stmt.run(id, name, model, dr, rr, hold, min, now);

  const pages: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ][] = [
    [
      "start",
      "Start Trading",
      "Stop watching the market. Start trading it.",
      "Live NSE, BSE and MCX on one clean terminal. Open your account in about two minutes and place your first trade today.",
      "Free practice credit on signup — trade before you fund",
      "Start Trading Free",
      "NSE · BSE · MCX",
      JSON.stringify([
        "Up to 20× leverage on intraday",
        "NSE, BSE and MCX in one watchlist",
        "Free practice credit — no deposit needed",
        "Withdraw to your own bank or UPI",
      ]),
    ],
    [
      "options",
      "Options Edge",
      "Trade options with the whole picture in front of you",
      "Live Greeks, payoff charts and an option chain that loads instantly. Stop guessing on expiry day — see the numbers before you click.",
      "Rehearse the desk with virtual money first",
      "Trade Options Now",
      "Options · F&O",
      JSON.stringify([
        "Every expiry on one live chain",
        "Greeks and payoffs on screen",
        "Up to 20× leverage on intraday",
        "Rehearse it with virtual money",
      ]),
    ],
    [
      "commodities",
      "MCX Commodities",
      "Gold, silver and crude — traded from the same terminal as your equities",
      "Live MCX contracts, charting and margins sitting next to your equity positions. One account, one watchlist, no second platform to learn.",
      "One account for NSE and MCX",
      "Trade Commodities",
      "MCX · Commodities",
      JSON.stringify([
        "Live gold, silver and crude contracts",
        "Up to 20× leverage on intraday",
        "Same terminal as your equities",
        "One account, no separate funding",
      ]),
    ],
    [
      "instant-deposit",
      "Fund In Seconds",
      "Fund in seconds. Trade the same minute.",
      "Top up by UPI or netbanking and the balance is credited the moment the payment gateway confirms it. No approval queue, no emailing screenshots, no waiting on a support ticket.",
      "Credited the moment the gateway confirms",
      "Fund & Start Trading",
      "UPI · Netbanking · Instant credit",
      JSON.stringify([
        "Top up by UPI or netbanking",
        "Balance updates the moment it clears",
        "No approval queue, no waiting",
        "Every deposit on your own ledger",
      ]),
    ],
    [
      "fast-withdrawal",
      "Money Out",
      "Your money out, to your own account",
      "Request a withdrawal from your wallet whenever you want. It goes only to the bank or UPI account in your own name — no tickets, no phone calls, no one asking for a screenshot.",
      "Paid only to an account in your own name",
      "Start Trading",
      "Bank · UPI · Your own account",
      JSON.stringify([
        "Request a withdrawal any time",
        "Paid to your own bank or UPI",
        "One clear status instead of chasing",
        "No support ticket to raise",
      ]),
    ],
    [
      "practice-first",
      "Practise First",
      "Learn the terminal with virtual money. Then trade for real.",
      "A full practice book with the same order tickets, the same charts and live market prices. Break things in there, not with your savings.",
      "Practice credit on signup — no deposit required",
      "Start Practising Free",
      "Virtual funds · Live prices · No risk",
      JSON.stringify([
        "Same terminal, virtual money",
        "Live NSE and MCX prices throughout",
        "Practice book kept apart from real funds",
        "Nothing at stake while you learn",
      ]),
    ],
    [
      "weekly-expiry",
      "Weekly Expiries",
      "Walk into expiry day already decided",
      "Live Greeks, payoff charts and an option chain that moves with the market — so expiry day is a decision you made, not a guess you regret.",
      "Chain, Greeks and payoff on one screen",
      "Trade This Expiry",
      "Weekly options · Greeks · Payoff",
      JSON.stringify([
        "Live option chain by expiry",
        "Greeks that move with the market",
        "Payoff chart before you commit",
        "Up to 20× leverage on intraday",
      ]),
    ],
    [
      "intraday-desk",
      "Intraday Desk",
      "Built for the people watching every tick",
      "Fast order tickets, real market depth and charts that keep up. Designed for traders who are actually at the screen when the market moves.",
      "Order status you can read at a glance",
      "Start Trading Now",
      "Intraday · Equities · Futures",
      JSON.stringify([
        "Up to 20× leverage on intraday",
        "One watchlist across NSE, BSE and MCX",
        "Live depth and candlesticks",
        "Order status without digging",
      ]),
    ],
  ];
  const pageStmt = db.prepare(
    `INSERT OR IGNORE INTO landing_pages
       (slug, title, headline, subheadline, offer, cta, tags, highlights, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const [
    slug,
    title,
    headline,
    subheadline,
    offer,
    cta,
    tags,
    highlights,
  ] of pages)
    pageStmt.run(
      slug,
      title,
      headline,
      subheadline,
      offer,
      cta,
      tags,
      highlights,
      now,
      now,
    );

  // Re-apply the seeded copy when LANDING_COPY_REV moves.
  //
  // `INSERT OR IGNORE` deliberately never updates an existing row, so without
  // this a copy change would only ever reach a brand-new database and the live
  // one would keep the old wording forever. This covers EVERY copy column, not
  // just highlights — a CTA edit that silently fails to ship is the same as no
  // edit at all.
  //
  // This was previously guarded on `updated_at = created_at`, on the theory that
  // it would stop overwriting once an operator made the copy their own. That
  // guard never worked. The first refresh wrote a `now` later than the row's
  // created_at, so from the second boot onward the condition was permanently
  // false and NO copy change ever shipped — the live CTA sat on "Start your
  // session" while the seed said otherwise. Nothing in the app writes to
  // landing_pages (every other reference is a SELECT), so there was nothing to
  // protect anyway. A revision marker does the job properly, and an admin editor
  // can clear or bump the same key if one is ever added.
  const COPY_REV_KEY = "landing_copy_rev";
  const storedRev =
    (db.prepare("SELECT v FROM kv WHERE k = ?").get(COPY_REV_KEY) as any)?.v ??
    null;

  if (storedRev !== String(LANDING_COPY_REV)) {
    const setCopy = db.prepare(
      `UPDATE landing_pages
          SET title = ?, headline = ?, subheadline = ?, offer = ?, cta = ?,
              tags = ?, highlights = ?, updated_at = ?
        WHERE slug = ?`,
    );
    for (const [
      slug,
      title,
      headline,
      subheadline,
      offer,
      cta,
      tags,
      highlights,
    ] of pages)
      setCopy.run(
        title,
        headline,
        subheadline,
        offer,
        cta,
        tags,
        highlights,
        now,
        slug,
      );
    db.prepare(
      "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    ).run(COPY_REV_KEY, String(LANDING_COPY_REV));
  }
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
