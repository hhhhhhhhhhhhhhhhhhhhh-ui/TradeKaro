import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db, kvGet, kvSet } from "./db";

export type AdminRole = "superadmin" | "operator" | "viewer";

export type AdminUser = {
  id: string;
  email: string;
  passHash: string;
  salt: string;
  role: AdminRole;
  totpSecret?: string;
  createdAt: number;
  lockedUntil?: number;
  failCount?: number;
};

export type AdminSession = {
  token: string;
  adminId: string;
  role: AdminRole;
  createdAt: number;
  expiresAt: number;
  ip?: string;
};

export type AuditEntry = {
  at: number;
  adminId: string;
  email: string;
  action: string;
  detail?: string;
  ip?: string;
};

export type AdminSettings = {
  upstoxToken: string;
  feedToken: string;
  providerOff: boolean;
  maintenance: boolean;
  banner: string;
  ttl: { quote: number; chain: number; candles: number; expiries: number };
  clientPollMs: number;
  tradeEngineMs: number;
  hiddenTabPause: boolean;
  tape: string[];
  rail: string[];
  chartDefaults: {
    tf: string;
    type: string;
    sma: boolean;
    ema: boolean;
    vwap: boolean;
    rsi: boolean;
    compare: boolean;
  };
  candleWindows: Record<string, { days: number; bucketMin: number }>;
  marketHours: { open: string; close: string; holidays: string[] };
  /** Order rules and limits. Renamed from `paper`; getSettings() migrates. */
  trading: {
    startCash: number;
    maxQty: number;
    maxPositions: number;
    allowShort: boolean;
    /** Margin requirement as a % of trade value. 5 ⇒ up to 20x leverage. */
    marginPct: number;
    brokerageFlat: number;
    brokeragePct: number;
    haltFills: boolean;
    /**
     * Permit orders outside the NSE session. Off by default — the honest
     * behaviour — but the platform is a simulator on live data, so without this
     * it would be untradeable every evening and all weekend.
     */
    allowAfterHours: boolean;
    autoSquareOff: boolean;
    squareOffTime: string;
    /**
     * Allow fractional commodity lots, down to a single quoted unit.
     *
     * On by default: a whole lot of MCX gold is Rs 1.53 crore and needs Rs 7.65
     * lakh of margin, so whole-lot-only leaves almost every commodity out of
     * reach on a practice balance. Turn it OFF to make the paper book mirror the
     * exchange exactly and accept whole lots only.
     */
    fractionalLots: boolean;
  };
  orderDefaults: { defaultQty: number; confirmOrders: boolean };
  alertLimits: { maxPerUser: number };
  /**
   * KYC is gated on how much the user has actually deposited. Kept next to the
   * trading rules because it shares their unit (rupees).
   */
  kyc: {
    /** Minimum total deposits before KYC can be completed. 0 = open to all. */
    minDeposit: number;
  };
  /**
   * Sunpays payment gateway.
   *
   * ⚠️ `enabled` is the master switch and defaults to OFF. While it is off,
   * every /api/payments route refuses and the Funds panel shows the old
   * self-service funding button — so deploying this code changes nothing for
   * anybody until an operator deliberately turns it on.
   *
   * Both key pairs are secrets. They live here and in the server env, never in
   * client code, and are never returned by /api/admin/public.
   */
  payments: {
    enabled: boolean;
    payinApiKey: string;
    payinApiSecret: string;
    payoutApiKey: string;
    payoutApiSecret: string;
    /** Overridable so the same build can be pointed at a sandbox. */
    baseUrl: string;
    minAmount: number;
    maxAmount: number;
    payoutsEnabled: boolean;
  };
  updatedAt: number;
  updatedBy?: string;
};

// All admin data lives in the central SQLite database: admin users and
// sessions as JSON blocks, settings in kv, actions in the audit table.

export const DEFAULT_SETTINGS: AdminSettings = {
  upstoxToken: "",
  feedToken: "",
  providerOff: false,
  maintenance: false,
  banner: "",
  ttl: { quote: 5000, chain: 5000, candles: 60000, expiries: 43200000 },
  clientPollMs: 8000,
  tradeEngineMs: 5000,
  hiddenTabPause: true,
  tape: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "RELIANCE",
    "TCS",
    "INFY",
    "SBIN",
    "TATAMOTORS",
    "HDFCBANK",
  ],
  rail: [
    "NIFTY",
    "BANKNIFTY",
    "RELIANCE",
    "TCS",
    "INFY",
    "SBIN",
    "HDFCBANK",
    "TATAMOTORS",
  ],
  chartDefaults: {
    tf: "day",
    type: "candles",
    sma: true,
    ema: false,
    vwap: false,
    rsi: false,
    compare: false,
  },
  candleWindows: {
    "1m": { days: 5, bucketMin: 1 },
    "5m": { days: 10, bucketMin: 5 },
    "15m": { days: 20, bucketMin: 15 },
    day: { days: 365, bucketMin: 0 },
    week: { days: 1095, bucketMin: 0 },
  },
  marketHours: { open: "09:15", close: "15:30", holidays: [] },
  trading: {
    startCash: 100000,
    maxQty: 10000,
    maxPositions: 50,
    allowShort: true,
    marginPct: 5,
    brokerageFlat: 0,
    brokeragePct: 0,
    haltFills: false,
    allowAfterHours: false,
    autoSquareOff: true,
    squareOffTime: "15:15",
    fractionalLots: true,
  },
  orderDefaults: { defaultQty: 1, confirmOrders: true },
  alertLimits: { maxPerUser: 20 },
  kyc: { minDeposit: 25000 },
  payments: {
    enabled: false,
    payinApiKey: "",
    payinApiSecret: "",
    payoutApiKey: "",
    payoutApiSecret: "",
    baseUrl: "https://ttpay.business/api/public/v1",
    minAmount: 100,
    maxAmount: 100000,
    payoutsEnabled: false,
  },
  updatedAt: Date.now(),
};

function blocksOf<T>(kind: string): T[] {
  const rows = db
    .prepare("SELECT json FROM blocks WHERE kind = ? ORDER BY at")
    .all(kind) as any[];
  return rows.map((r) => JSON.parse(String(r.json)) as T);
}

function saveBlocks<T>(kind: string, arr: T[]) {
  const del = db.prepare("DELETE FROM blocks WHERE kind = ?");
  const ins = db.prepare(
    "INSERT INTO blocks (kind, id, json, at) VALUES (?,?,?,?)",
  );
  db.exec("BEGIN");
  try {
    del.run(kind);
    arr.forEach((item, i) => {
      const id = String((item as any)?.id ?? (item as any)?.token ?? i);
      ins.run(kind, id, JSON.stringify(item), i);
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export async function getUsers(): Promise<AdminUser[]> {
  return blocksOf<AdminUser>("admin_users");
}

export async function saveUsers(u: AdminUser[]) {
  saveBlocks("admin_users", u);
}

export async function getSessions(): Promise<AdminSession[]> {
  const all = blocksOf<AdminSession>("admin_sessions");
  const now = Date.now();
  const live = all.filter((s) => s.expiresAt > now);
  if (live.length !== all.length) saveBlocks("admin_sessions", live);
  return live;
}

export async function saveSessions(s: AdminSession[]) {
  saveBlocks("admin_sessions", s);
}

export async function getSettings(): Promise<AdminSettings> {
  let s: AdminSettings = DEFAULT_SETTINGS;
  try {
    const raw = kvGet("admin_settings");
    if (raw) s = JSON.parse(raw) as AdminSettings;
  } catch {
    /* fall back to defaults */
  }
  // Coerce top-level switches: a past admin bug saved some as nested
  // objects ({ maintenance: { maintenance: false } }), which are always
  // truthy and could never be turned off. Heal on read.
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    providerOff: bool((s as any)?.providerOff, DEFAULT_SETTINGS.providerOff),
    maintenance: bool((s as any)?.maintenance, DEFAULT_SETTINGS.maintenance),
    hiddenTabPause: bool(
      (s as any)?.hiddenTabPause,
      DEFAULT_SETTINGS.hiddenTabPause,
    ),
    feedToken:
      typeof (s as any)?.feedToken === "string"
        ? (s as any).feedToken
        : DEFAULT_SETTINGS.feedToken,
    ttl: { ...DEFAULT_SETTINGS.ttl, ...(s as any)?.ttl },
    // `paper` was the original key for this block. Anything already customised
    // in a live console is stored under it, so fall back to it rather than
    // silently resetting every limit to the defaults.
    trading: {
      ...DEFAULT_SETTINGS.trading,
      ...((s as any)?.trading ?? (s as any)?.paper),
    },
    kyc: { ...DEFAULT_SETTINGS.kyc, ...(s as any)?.kyc },
    payments: {
      ...DEFAULT_SETTINGS.payments,
      ...(s as any)?.payments,
      // Same healing as the top-level switches above: a truthy object can never
      // be turned back off, and this one gates whether real money can be taken.
      enabled: bool(
        (s as any)?.payments?.enabled,
        DEFAULT_SETTINGS.payments.enabled,
      ),
      payoutsEnabled: bool(
        (s as any)?.payments?.payoutsEnabled,
        DEFAULT_SETTINGS.payments.payoutsEnabled,
      ),
    },
  };
}

export async function saveSettings(s: AdminSettings) {
  // Drop the legacy key on write so a stale copy cannot shadow `trading` later.
  const { paper: _legacy, ...rest } = s as any;
  kvSet("admin_settings", JSON.stringify({ ...rest, updatedAt: Date.now() }));
}

export async function audit(e: AuditEntry) {
  db.prepare(
    "INSERT INTO audit (at, admin_id, email, action, detail, ip) VALUES (?,?,?,?,?,?)",
  ).run(
    Number(e.at) || Date.now(),
    String(e.adminId || ""),
    String(e.email || ""),
    String(e.action || ""),
    String(e.detail || ""),
    String(e.ip || ""),
  );
}

export async function readAudit(limit = 200): Promise<AuditEntry[]> {
  const rows = db
    .prepare("SELECT * FROM audit ORDER BY at DESC, id DESC LIMIT ?")
    .all(Math.max(1, Math.min(1000, limit))) as any[];
  return rows.map((r) => ({
    at: Number(r.at) || 0,
    adminId: String(r.admin_id || ""),
    email: String(r.email || ""),
    action: String(r.action || ""),
    detail: String(r.detail || ""),
    ip: String(r.ip || ""),
  }));
}

export function hashPass(pass: string, salt: string) {
  return createHash("sha256").update(`${salt}:${pass}`).digest("hex");
}

export function newSalt() {
  return randomBytes(16).toString("hex");
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Bootstrap from env on first run so the owner can log in once,
// then rotate the password from inside the panel.
export async function ensureBootstrapAdmin(): Promise<{
  email: string;
  fresh: boolean;
}> {
  const email = (process.env.ADMIN_EMAIL || "admin@local").toLowerCase();
  const users = await getUsers();
  if (users.some((u) => u.email === email)) return { email, fresh: false };
  const pass = process.env.ADMIN_PASSWORD || randomBytes(12).toString("hex");
  const salt = newSalt();
  users.push({
    id: randomBytes(8).toString("hex"),
    email,
    passHash: hashPass(pass, salt),
    salt,
    role: "superadmin",
    createdAt: Date.now(),
    failCount: 0,
  });
  await saveUsers(users);
  if (!process.env.ADMIN_PASSWORD)
    console.log(`[admin] bootstrap password for ${email}: ${pass}`);
  return { email, fresh: true };
}
