import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { db } from "./db";
import { codesInUse, generateClientCode } from "./clientCode";
import { normalisePhone } from "./phone";

// Self-hosted account store on the central SQLite database (data/trade.db).
// Sessions are HMAC-signed JWTs; passwords arrive as sha256(client) and are
// stored scrypt-hashed on top. Watchlists live in their own table, so taps
// no longer rewrite a whole users file.

export type User = {
  id: string;
  /** Broker-style display ID (TK267X9Q4). Never used as a key. */
  clientCode: string;
  username: string;
  email: string;
  /** Bare 10-digit Indian mobile, or "" when not supplied. Unverified. */
  phone: string;
  passHash: string;
  salt: string;
  createdAt: number;
  watchlist: string[];
};

const DIR = path.join(process.cwd(), "data", "auth");
const SECRET_F = path.join(DIR, "secret");

let secretCache: string | null = null;

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

function rowToUser(r: any, watchlist: string[]): User {
  return {
    id: String(r.id),
    clientCode: String(r.client_code || ""),
    username: String(r.username),
    email: String(r.email),
    phone: String(r.phone || ""),
    passHash: String(r.pass_hash),
    salt: String(r.salt),
    createdAt: Number(r.created_at),
    watchlist,
  };
}

function watchlistMap(): Map<string, string[]> {
  const rows = db
    .prepare("SELECT user_id, symbol FROM watchlist ORDER BY added_at")
    .all() as any[];
  const map = new Map<string, string[]>();
  for (const w of rows) {
    const arr = map.get(w.user_id) ?? [];
    arr.push(String(w.symbol));
    map.set(String(w.user_id), arr);
  }
  return map;
}

export async function getUsers(): Promise<User[]> {
  const wl = watchlistMap();
  const rows = db.prepare("SELECT * FROM users").all() as any[];
  return rows.map((r) => rowToUser(r, wl.get(r.id) ?? []));
}

/** Does this account still exist? */
export function accountExists(id: string): boolean {
  if (!id) return false;
  const row = db.prepare("SELECT id FROM users WHERE id = ?").get(String(id));
  return !!row;
}

/**
 * A session that is BOTH correctly signed AND still belongs to a real account.
 *
 * ⚠️ `verifyToken` is deliberately stateless: it checks a JWT's signature and
 * expiry and nothing else, which is what keeps these hot paths off the database.
 * The cost is that DELETING AN ACCOUNT DOES NOT END ITS SESSION. The token stays
 * valid until it expires, the identity cookies (`username`, `email`, `clientID`)
 * keep rendering a signed-in customer, and `ensureAccount` cheerfully re-creates
 * a ledger row for an id that no longer exists — so a wiped account carries on
 * browsing an empty shell of itself. That is exactly what happened after the
 * production wipe.
 *
 * Anything that reads or moves account state uses this instead, so a deleted
 * account is logged out rather than merely emptied. Rotating `AUTH_SECRET` is
 * still the way to end every session at once.
 */
export async function liveToken(
  token: string | undefined,
): Promise<{ id: string; username: string; email: string } | null> {
  const claims = await verifyToken(token);
  if (!claims) return null;
  return accountExists(claims.id) ? claims : null;
}

// Signing secret: env wins (works in edge middleware too); otherwise a
// generated file keeps local sessions valid across restarts.
export async function authSecret(): Promise<string> {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (secretCache) return secretCache;
  try {
    const s = (await fs.readFile(SECRET_F, "utf8")).trim();
    if (s) {
      secretCache = s;
      return s;
    }
  } catch {
    /* generate below */
  }
  const s = randomBytes(32).toString("hex");
  await ensureDir();
  await fs.writeFile(SECRET_F, s);
  secretCache = s;
  return s;
}

export function hashPassword(clientHash: string, salt: string) {
  return scryptSync(clientHash, salt, 64).toString("hex");
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export async function issueToken(user: User, days = 7): Promise<string> {
  const secret = await authSecret();
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp,
    }),
  );
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function verifyToken(
  token: string | undefined,
): Promise<{ id: string; username: string; email: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const secret = await authSecret();
  const expect = createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  const a = Buffer.from(expect);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (!payload?.sub || !payload?.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return {
      id: String(payload.sub),
      username: String(payload.username || ""),
      email: String(payload.email || ""),
    };
  } catch {
    return null;
  }
}

export async function tokenFromRequest(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  const cookie = req.headers.get("cookie") || "";
  const m = /(?:^|;\s*)token=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function currentUser(req: Request): Promise<User | null> {
  const claims = await verifyToken(await tokenFromRequest(req));
  if (!claims) return null;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(claims.id) as
    | any
    | undefined;
  if (!row) return null;
  const wl = db
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at")
    .all(claims.id) as any[];
  return rowToUser(
    row,
    wl.map((w) => String(w.symbol)),
  );
}

export type ConflictField = "username" | "email" | "phone";

export async function createUser(
  username: string,
  email: string,
  clientHash: string,
  phone = "",
): Promise<User | { error: "exists"; field: ConflictField }> {
  const uname = username.toLowerCase();
  const mail = email.toLowerCase();
  const ph = normalisePhone(phone);

  // Report WHICH one clashed — the caller can then say "that number is already
  // registered" instead of a vague "username or email exists".
  if (db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(uname))
    return { error: "exists", field: "username" };
  if (db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(mail))
    return { error: "exists", field: "email" };
  if (ph && db.prepare("SELECT id FROM users WHERE phone = ?").get(ph))
    return { error: "exists", field: "phone" };

  const salt = randomBytes(16).toString("hex");
  const createdAt = Date.now();
  const user: User = {
    id: randomBytes(8).toString("hex"),
    // Allocated here, not derived — `id` stays the opaque primary key. The
    // year comes from the signup date so the code reads as a real account
    // opening rather than the day the row happened to be written.
    clientCode: generateClientCode(
      new Date(createdAt).getUTCFullYear(),
      codesInUse(
        db
          .prepare(
            "SELECT client_code FROM users WHERE client_code IS NOT NULL AND client_code <> ''",
          )
          .all() as { client_code: string }[],
      ),
    ),
    username,
    email,
    phone: ph,
    salt,
    passHash: hashPassword(clientHash, salt),
    createdAt,
    watchlist: [],
  };
  try {
    db.prepare(
      "INSERT INTO users (id, username, email, phone, pass_hash, salt, created_at, client_code) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      user.id,
      user.username,
      user.email,
      user.phone || null,
      user.passHash,
      user.salt,
      user.createdAt,
      user.clientCode,
    );
  } catch {
    // Unique index raced us — treat as exists.
    return { error: "exists", field: "username" };
  }
  return user;
}

export async function verifyLogin(
  identifier: string,
  clientHash: string,
): Promise<User | null> {
  const id = String(identifier || "").trim();
  const lower = id.toLowerCase();
  // Accepts a username, an email, or a bare/+91 mobile number. The digit form
  // is normalised first so "+91 98765 43210" and "9876543210" both resolve.
  const row = db
    .prepare(
      `SELECT * FROM users
        WHERE lower(username) = ?
           OR lower(email) = ?
           OR (phone IS NOT NULL AND phone <> '' AND phone = ?)`,
    )
    .get(lower, lower, normalisePhone(id)) as any | undefined;
  if (!row) return null;
  const expect = Buffer.from(hashPassword(clientHash, row.salt));
  const actual = Buffer.from(row.pass_hash);
  if (expect.length !== actual.length || !timingSafeEqual(expect, actual))
    return null;
  const wl = db
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at")
    .all(row.id) as any[];
  return rowToUser(
    row,
    wl.map((w) => String(w.symbol)),
  );
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "passHash" | "salt" | "watchlist">>,
): Promise<User | null> {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | any
    | undefined;
  if (!row) return null;
  if (patch.passHash || patch.salt) {
    db.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").run(
      patch.passHash ?? row.pass_hash,
      patch.salt ?? row.salt,
      id,
    );
  }
  if (Array.isArray(patch.watchlist)) {
    const del = db.prepare("DELETE FROM watchlist WHERE user_id = ?");
    const ins = db.prepare(
      "INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?,?,?)",
    );
    db.exec("BEGIN");
    try {
      del.run(id);
      patch.watchlist.forEach((s, i) =>
        ins.run(id, String(s).toUpperCase(), Date.now() + i),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  const wl = db
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at")
    .all(id) as any[];
  return rowToUser(
    updated,
    wl.map((w) => String(w.symbol)),
  );
}

// Ledger key for a signed-in user (survives re-login).
export function ledgerKeyFor(userId: string) {
  return `u-${userId}`;
}
