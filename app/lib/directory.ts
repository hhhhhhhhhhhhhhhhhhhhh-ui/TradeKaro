import "server-only";
import { db } from "./db";
import { getClients, type ClientRecord } from "./clientRegistry";
import { depositedTotals } from "./deposits";
import { normalizeWithdrawKyc, type WithdrawKycMode } from "./withdrawKyc";

// ── Unified client directory ────────────────────────────────────────────────
//
// The admin Users & KYC tab used to read ONLY the heartbeat registry, so anyone
// who registered but never logged in was invisible — 30 of 39 users on this
// deployment. Registration writes to `users`; activity writes to the heartbeat
// registry; this module merges them so the panel shows every real account,
// with heartbeat data used purely as enrichment.

export type DirectoryUser = {
  /** Canonical id: the `users` row id when registered, else the registry id. */
  id: string;
  username: string;
  email: string;
  /** Bare 10-digit number, or "" — collected at signup, not yet verified. */
  phone: string;
  clientID: string;
  /** Broker-style display ID (TK267X9Q4). Empty for heartbeat-only rows. */
  clientCode: string;
  panLast4: string;
  kyc: string;
  /**
   * This user's withdrawal-KYC override: `inherit` | `require` | `waive`.
   * `inherit` means the platform switch decides — see `withdrawKyc.ts`.
   */
  withdrawKyc: WithdrawKycMode;
  status: "ACTIVE" | "FROZEN";
  note: string;
  cash?: number;
  marginPct?: number;
  /** Total funded through the deposit ledger. Gates KYC. */
  deposited: number;
  logins: number;
  firstSeen: number;
  lastSeen: number;
  /** Present in the `users` table (i.e. actually signed up). */
  registered: boolean;
  /** Signed up but never checked in — no activity data at all. */
  neverLoggedIn: boolean;
  createdAt: number;
  /** Looks like a dev/smoke/test account rather than a real student. */
  isTest: boolean;
};

// Smoke fixtures, load tests and my own probes all land in this shape. Used to
// keep the default view readable — an admin can still show them.
const TEST_EMAIL = /@(test\.local|example\.(com|org|net)|localhost)$/i;
const TEST_NAME =
  /^(smoke[_-]?|test[_-]?|perf|tamper|sec\d|lv\d{3}|expcheck|exptest|mismu|clean\d|zqauto|autotest|browsertest|normtest|probe)/i;

export function isTestAccount(username: unknown, email: unknown): boolean {
  const n = String(username || "");
  const e = String(email || "");
  return TEST_NAME.test(n) || TEST_EMAIL.test(e);
}

type UserRow = {
  id: string;
  username: string;
  email: string;
  phone: string | null;
  created_at: number;
  client_code: string | null;
};

function emptyFromUser(u: UserRow): DirectoryUser {
  return {
    id: String(u.id),
    username: String(u.username || ""),
    email: String(u.email || ""),
    phone: String(u.phone || ""),
    clientID: String(u.id),
    // What a customer actually recognises. `clientID` stays for lookups.
    clientCode: String(u.client_code || ""),
    panLast4: "",
    kyc: "UNKNOWN",
    withdrawKyc: "inherit",
    status: "ACTIVE",
    note: "",
    deposited: 0,
    logins: 0,
    firstSeen: 0,
    lastSeen: 0,
    registered: true,
    neverLoggedIn: true,
    createdAt: Number(u.created_at) || 0,
    isTest: isTestAccount(u.username, u.email),
  };
}

function fromHeartbeat(r: ClientRecord): DirectoryUser {
  return {
    id: String(r.id),
    username: String(r.username || ""),
    email: String(r.email || ""),
    phone: "",
    clientID: String(r.clientID || ""),
    // A heartbeat carries no client code: these rows are registry-only, so
    // there is no `users` record to read one from.
    clientCode: "",
    panLast4: String(r.panLast4 || ""),
    kyc: String(r.kyc || "UNKNOWN"),
    withdrawKyc: normalizeWithdrawKyc(r.withdrawKyc),
    status: r.status === "FROZEN" ? "FROZEN" : "ACTIVE",
    note: String(r.note || ""),
    cash: typeof r.cash === "number" ? r.cash : undefined,
    marginPct: typeof r.marginPct === "number" ? r.marginPct : undefined,
    deposited: 0,
    logins: Number(r.loginCount) || 0,
    firstSeen: Number(r.firstSeen) || 0,
    lastSeen: Number(r.lastSeen) || 0,
    registered: false,
    neverLoggedIn: false,
    createdAt: Number(r.firstSeen) || 0,
    isTest: isTestAccount(r.username, r.email),
  };
}

// Newest activity first; accounts that never checked in sort by signup date.
function activityAt(u: DirectoryUser): number {
  return u.lastSeen || u.createdAt || 0;
}

export async function getDirectory(): Promise<DirectoryUser[]> {
  const users = db
    .prepare(
      "SELECT id, username, email, phone, created_at, client_code FROM users",
    )
    .all() as UserRow[];
  const clients = await getClients();

  // Index the registry by every key a heartbeat might have used.
  const byClientID = new Map<string, ClientRecord>();
  const byEmail = new Map<string, ClientRecord>();
  const byName = new Map<string, ClientRecord>();
  for (const c of clients) {
    if (c.clientID) byClientID.set(String(c.clientID), c);
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
    if (c.username) byName.set(String(c.username).toLowerCase(), c);
  }

  const used = new Set<ClientRecord>();
  const out: DirectoryUser[] = [];

  for (const u of users) {
    const match =
      byClientID.get(String(u.id)) ||
      byEmail.get(String(u.email || "").toLowerCase()) ||
      byName.get(String(u.username || "").toLowerCase());
    if (!match) {
      out.push(emptyFromUser(u));
      continue;
    }
    used.add(match);
    const merged: DirectoryUser = {
      ...emptyFromUser(u),
      ...fromHeartbeat(match),
      // Registration is the identity source; heartbeat only enriches.
      id: String(u.id),
      username: String(u.username || match.username || ""),
      email: String(u.email || match.email || ""),
      phone: String(u.phone || ""),
      clientID: String(u.id),
      clientCode: String(u.client_code || ""),
      registered: true,
      neverLoggedIn: false,
      createdAt: Number(u.created_at) || 0,
    };
    out.push(merged);
  }

  // Registry rows with no matching account: legacy/imported or pre-registration
  // heartbeats. Still worth showing so nothing silently disappears.
  for (const c of clients) {
    if (!used.has(c)) out.push(fromHeartbeat(c));
  }

  // One query for the whole directory rather than one per row. The ledger's
  // user_id is the account key (`u-<users.id>`, see authStore.ledgerKeyFor).
  const funded = depositedTotals();
  for (const u of out) u.deposited = funded.get(`u-${u.id}`) ?? 0;

  return out.sort((a, b) => activityAt(b) - activityAt(a));
}

/** Find one directory entry by its canonical id. */
export async function findDirectoryUser(
  id: string,
): Promise<DirectoryUser | null> {
  const want = String(id || "");
  if (!want) return null;
  const all = await getDirectory();
  return all.find((u) => u.id === want) || null;
}

/**
 * Operator-set KYC status and standing for one account.
 *
 * Resolved through the directory merge rather than by matching email in the raw
 * registry: a user typically has several registry rows (one per heartbeat
 * identity), so a bare email match can land on a stale row and disagree with
 * what Users & KYC shows. Passing the canonical id keeps the two in step.
 */
export async function standingForUser(
  userId: string,
): Promise<{ kyc: string; status: "ACTIVE" | "FROZEN" }> {
  const u = await findDirectoryUser(userId);
  const kyc = String(u?.kyc || "UNKNOWN").toUpperCase();
  return {
    kyc: u ? kyc : "UNKNOWN",
    status: u?.status === "FROZEN" ? "FROZEN" : "ACTIVE",
  };
}
