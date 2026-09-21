import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import { hashPartnerPassword, newSalt } from "./affiliateAuth";
import { serialiseSignals, type ClickSignals } from "./tracking";

// ── Affiliate / partner domain ──────────────────────────────────────────────
//
// Everything a partner panel needs, on the same SQLite file as the rest of the
// platform. Deliberate choices worth knowing before editing:
//
//   • No payout API. A partner REQUESTS money; an operator sends it and marks
//     it paid. A UPI or USDT transfer cannot be reversed, so no code path here
//     is allowed to move funds on its own.
//
//   • No gateway fees anywhere. The user asked for fees to be ignored, so a
//     commission is a straight percentage of the verified deposit. If that ever
//     changes it changes in `attributeDeposit` alone.
//
//   • Deposits are the only thing that earns. Practice credits (`method` is
//     anything other than admin/gateway) are not real money and produce nothing.
//
//   • Commission models, in plain words:
//       deposit  → "Deposit %"       a one-off cut of the customer's FIRST deposit
//       revshare → "Recurring share" a cut of EVERY verified deposit
//       hybrid   → both: deposit_rate on the first, rev_rate on every one
//     So the model names survive the intent: a partner paid on first-deposit
//     only is not accidentally paid forever, and vice versa.

export type Affiliate = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  audience: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  planId: string | null;
  planName: string;
  model: "deposit" | "revshare" | "hybrid";
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
  note: string;
  rejectReason: string;
  createdAt: number;
  decidedAt: number | null;
  lastLogin: number | null;
  loginCount: number;
};

export type Commission = {
  id: number;
  kind: "Deposit %" | "Recurring share";
  amount: number;
  base: number;
  rate: number;
  status: "pending" | "approved" | "paid" | "reversed";
  createdAt: number;
  releaseAt: number | null;
  customer: string;
};

export type PayoutRow = {
  id: string;
  amount: number;
  method: string;
  destination: string;
  status: "requested" | "approved" | "paid" | "rejected";
  note: string;
  utr: string;
  requestedAt: number;
  decidedAt: number | null;
};

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = "") =>
  v === null || v === undefined ? d : String(v);

/**
 * The ONLY commission models this programme has. A closed set, on purpose.
 *
 * There is deliberately no CPA: it was scaffolded, never implemented, and
 * removed at schema rev 13 rather than left as a field that promised a payout
 * nothing computed. If a fourth model is ever wanted it needs a real design —
 * what triggers it, whether it claws back, whether it stacks — not just an
 * option in a dropdown.
 *
 * Defined here once and imported by the console API, so the set cannot drift
 * between the UI, the validator and the engine.
 */
export const COMMISSION_MODELS = ["deposit", "revshare", "hybrid"] as const;
export type CommissionModel = (typeof COMMISSION_MODELS)[number];

export function isCommissionModel(v: unknown): v is CommissionModel {
  return (COMMISSION_MODELS as readonly string[]).includes(String(v ?? ""));
}

/** Human label for a model id. */
export function modelLabel(model: string) {
  if (model === "revshare") return "Recurring share";
  if (model === "hybrid") return "Hybrid";
  return "Deposit %";
}

// ── identity ────────────────────────────────────────────────────────────────

/**
 * Referral code, `PT-` prefix so it is never mistaken for a broker client code.
 * Ambiguous characters (0/O, 1/I) are excluded: these codes get read aloud and
 * typed off screenshots.
 */
function newCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 40; attempt++) {
    const b = randomBytes(6);
    let s = "";
    for (let i = 0; i < 6; i++) s += A[b[i] % A.length];
    const code = `PT-${s}`;
    const clash = db
      .prepare(`SELECT 1 AS ok FROM affiliates WHERE code = ?`)
      .get(code) as { ok?: number } | undefined;
    if (!clash) return code;
  }
  return `PT-${Date.now().toString(36).toUpperCase()}`;
}

const SELECT_AFF = `
  SELECT a.*, p.name AS plan_name, p.model AS plan_model,
         p.deposit_rate AS plan_deposit_rate, p.rev_rate AS plan_rev_rate,
         p.hold_days AS plan_hold, p.min_payout AS plan_min
  FROM affiliates a LEFT JOIN affiliate_plans p ON p.id = a.plan_id
`;

/** Plan values, with any per-affiliate override applied on top. */
function shape(r: any): Affiliate {
  const model =
    (r.model as Affiliate["model"]) ||
    (r.plan_model as Affiliate["model"]) ||
    "deposit";
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    company: str(r.company),
    website: str(r.website),
    audience: str(r.audience),
    status: (str(r.status, "pending") as Affiliate["status"]) || "pending",
    planId: r.plan_id ? str(r.plan_id) : null,
    planName: str(r.plan_name, "Standard"),
    model,
    // A null override means "inherit the plan" — 0 is a real, meaningful value
    // (a plan that pays 0% on deposit) so it must not be treated as missing.
    depositRate:
      r.deposit_rate === null ? num(r.plan_deposit_rate) : num(r.deposit_rate),
    revRate: r.rev_rate === null ? num(r.plan_rev_rate) : num(r.rev_rate),
    holdDays:
      r.plan_hold === null || r.plan_hold === undefined
        ? 21
        : num(r.plan_hold, 21),
    minPayout:
      r.plan_min === null || r.plan_min === undefined
        ? 1000
        : num(r.plan_min, 1000),
    note: str(r.note),
    rejectReason: str(r.reject_reason),
    createdAt: num(r.created_at),
    decidedAt: r.decided_at ? num(r.decided_at) : null,
    lastLogin: r.last_login ? num(r.last_login) : null,
    loginCount: num(r.login_count),
  };
}

export function affiliateById(id: string): Affiliate | null {
  const r = db.prepare(`${SELECT_AFF} WHERE a.id = ?`).get(String(id));
  return r ? shape(r) : null;
}

export function affiliateByEmail(email: string): any | null {
  return (
    db
      .prepare(`SELECT * FROM affiliates WHERE lower(email) = lower(?)`)
      .get(String(email).trim()) || null
  );
}

export function affiliateByCode(code: string): Affiliate | null {
  if (!code) return null;
  const r = db
    .prepare(`${SELECT_AFF} WHERE upper(a.code) = upper(?)`)
    .get(String(code).trim());
  return r ? shape(r) : null;
}

export type RegisterInput = {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  audience?: string;
  /** sha256 of the password, computed in the browser. */
  password: string;
};

/**
 * Create an application. New affiliates always start `pending` — approval is a
 * human decision in the admin console, never something the signup form can set.
 */
export function registerAffiliate(input: RegisterInput) {
  const name = String(input.name || "").trim();
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  const password = String(input.password || "").trim();

  if (name.length < 2)
    return { ok: false as const, error: "Enter your name", status: 400 };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return {
      ok: false as const,
      error: "Enter a valid email address",
      status: 400,
    };
  if (password.length < 16)
    // The client always sends a sha256 hex (64 chars); anything shorter means
    // the raw password was posted, which we must never store.
    return {
      ok: false as const,
      error: "Password was not hashed by the client",
      status: 400,
    };

  const existing = affiliateByEmail(email);
  if (existing) {
    // Same reply whether the row is pending or rejected: telling an anonymous
    // form "that email was rejected" leaks a business decision.
    return {
      ok: false as const,
      error:
        "An application already exists for this email. Please sign in, or write to us if you never heard back.",
      status: 409,
    };
  }

  const phone = String(input.phone || "")
    .replace(/\D/g, "")
    .slice(-10);
  if (phone && !/^[6-9]\d{9}$/.test(phone))
    return {
      ok: false as const,
      error: "Enter a valid 10-digit mobile number",
      status: 400,
    };

  const id = `af_${randomBytes(9).toString("hex")}`;
  const salt = newSalt();
  db.prepare(
    `INSERT INTO affiliates
       (id, code, name, email, phone, company, website, audience,
        pass_hash, salt, status, plan_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', 'pl-std', ?)`,
  ).run(
    id,
    newCode(),
    name.slice(0, 120),
    email.slice(0, 160),
    phone,
    String(input.company || "").slice(0, 160),
    String(input.website || "").slice(0, 200),
    String(input.audience || "").slice(0, 400),
    hashPartnerPassword(password, salt),
    salt,
    Date.now(),
  );
  // Terms from day one, so any deposit this partner ever brings in can be
  // reconciled against the rate that was in force when it arrived.
  recordTerms({
    affiliateId: id,
    actor: "system",
    reason: "affiliate registered",
  });
  return { ok: true as const, affiliate: affiliateById(id)! };
}

/** Verify a password against the stored scrypt hash. */
export function verifyPartnerLogin(email: string, clientHash: string) {
  const row = affiliateByEmail(email);
  if (!row) return null;
  const expect = hashPartnerPassword(String(clientHash), String(row.salt));
  const a = Buffer.from(expect);
  const b = Buffer.from(String(row.pass_hash));
  if (a.length !== b.length || !a.equals(b)) return null;
  return affiliateById(String(row.id));
}

export function touchLogin(id: string) {
  db.prepare(
    `UPDATE affiliates SET login_count = login_count + 1, last_login = ? WHERE id = ?`,
  ).run(Date.now(), id);
}

/**
 * Change a password. The current password is required even though the caller
 * already holds a session — a stolen cookie should not be enough to lock the
 * real owner out of their own account.
 */
export function changePartnerPassword(
  id: string,
  currentClientHash: string,
  nextClientHash: string,
) {
  const row = db
    .prepare(`SELECT pass_hash, salt FROM affiliates WHERE id = ?`)
    .get(String(id)) as { pass_hash?: string; salt?: string } | undefined;
  if (!row)
    return { ok: false as const, error: "Account not found", status: 404 };

  const expect = hashPartnerPassword(
    String(currentClientHash),
    String(row.salt),
  );
  const a = Buffer.from(expect);
  const b = Buffer.from(String(row.pass_hash));
  if (a.length !== b.length || !a.equals(b))
    return {
      ok: false as const,
      error: "Your current password is not correct",
      status: 401,
    };

  if (String(nextClientHash).length < 16)
    return {
      ok: false as const,
      error: "Password was not hashed by the client",
      status: 400,
    };

  const salt = newSalt();
  db.prepare(`UPDATE affiliates SET pass_hash = ?, salt = ? WHERE id = ?`).run(
    hashPartnerPassword(String(nextClientHash), salt),
    salt,
    String(id),
  );
  return { ok: true as const };
}

// ── plans & admin decisions ─────────────────────────────────────────────────

export function plans() {
  return (
    db
      .prepare(
        `SELECT id, name, model, deposit_rate, rev_rate, hold_days, min_payout
         FROM affiliate_plans WHERE active = 1 ORDER BY deposit_rate DESC`,
      )
      .all() as any[]
  ).map((p) => ({
    id: str(p.id),
    name: str(p.name),
    model: str(p.model, "deposit"),
    modelLabel: modelLabel(str(p.model)),
    depositRate: num(p.deposit_rate),
    revRate: num(p.rev_rate),
    holdDays: num(p.hold_days, 21),
    minPayout: num(p.min_payout, 1000),
  }));
}

/** Approve / reject / suspend, and set the commercial terms in one write. */
export function decideAffiliate(input: {
  id: string;
  status?: string;
  planId?: string | null;
  model?: string | null;
  depositRate?: number | null;
  revRate?: number | null;
  note?: string | null;
  rejectReason?: string | null;
  actor?: string | null;
}) {
  const id = String(input.id || "");
  const aff = affiliateById(id);
  if (!aff)
    return { ok: false as const, error: "Affiliate not found", status: 404 };

  const sets: string[] = [];
  const args: any[] = [];
  const push = (col: string, v: any) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };

  if (input.status) {
    const s = String(input.status);
    if (!["pending", "approved", "rejected", "suspended"].includes(s))
      return { ok: false as const, error: "Unknown status", status: 400 };
    if (s !== aff.status) {
      push("status", s);
      push("decided_at", Date.now());
      push(
        "decided_by",
        input.actor ? String(input.actor).slice(0, 128) : null,
      );
    }
  }
  if (input.planId !== undefined) push("plan_id", input.planId || null);
  if (input.model !== undefined)
    push("model", input.model ? String(input.model) : null);
  if (input.depositRate !== undefined)
    push(
      "deposit_rate",
      input.depositRate === null ? null : num(input.depositRate),
    );
  if (input.revRate !== undefined)
    push("rev_rate", input.revRate === null ? null : num(input.revRate));
  if (input.note !== undefined)
    push("note", input.note ? String(input.note).slice(0, 400) : null);
  if (input.rejectReason !== undefined)
    push(
      "reject_reason",
      input.rejectReason ? String(input.rejectReason).slice(0, 300) : null,
    );

  if (!sets.length) return { ok: true as const, affiliate: aff };
  args.push(id);
  db.prepare(`UPDATE affiliates SET ${sets.join(", ")} WHERE id = ?`).run(
    ...args,
  );

  const next = affiliateById(id)!;
  // Append the new terms if anything that decides money actually changed.
  //
  // Compared field by field rather than "did the console send a rate": an
  // operator re-saving an untouched form would otherwise append a history entry
  // every time, and a history full of no-op entries is one nobody reads. A
  // status-only change (suspend, approve) cannot affect what an old deposit
  // earned, so it is deliberately not recorded here.
  const termsChanged =
    next.model !== aff.model ||
    next.planId !== aff.planId ||
    next.depositRate !== aff.depositRate ||
    next.revRate !== aff.revRate ||
    next.holdDays !== aff.holdDays;
  if (termsChanged)
    recordTerms({
      affiliateId: id,
      actor: input.actor,
      reason: "commercial terms changed in the console",
    });

  return { ok: true as const, affiliate: next };
}

export function listAffiliates(status?: string) {
  const where = status && status !== "all" ? `WHERE a.status = ?` : "";
  const rows = db
    .prepare(
      `${SELECT_AFF} ${where} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,
       a.created_at DESC LIMIT 500`,
    )
    .all(...(where ? [String(status)] : [])) as any[];
  return rows.map(shape);
}

// ── tracking ────────────────────────────────────────────────────────────────

/** Record a landing-page hit. Server-side, so clearing cookies loses nothing. */
/** YYYY-MM-DD in UTC — the bucket a device is de-duplicated within. */
const dayKeyOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * A short, non-reversible key for "this browser, roughly".
 *
 * Hashed rather than stored as raw ip+ua so the column is a compact index key,
 * and truncated because 16 hex chars is already far more than enough to tell
 * two visitors apart. It is a de-duplication aid, NOT a fingerprint: it is not
 * used to identify anybody, and nothing else in the system joins on it.
 */
function deviceKey(ip: string, ua: string) {
  if (!ip && !ua) return "";
  return createHash("sha256")
    .update(`${ip}\u0000${ua}`)
    .digest("hex")
    .slice(0, 16);
}

export type ClickResult = {
  recorded: boolean;
  unique: boolean;
  /** Row id, so a later consent decision can be written onto the same click. */
  id?: number;
  reason?: "preview" | "unknown_code" | "no_code";
};

/**
 * Record a landing-page hit.
 *
 * Three things this deliberately does NOT do any more:
 *
 *   • It does not count a PREVIEW. The partner panel used to open the plain
 *     link, so every time a partner checked their own link worked they added a
 *     click and no signup — quietly making their own conversion rate worse.
 *     A preview is now flagged and dropped, because it is not a visitor.
 *
 *   • It does not treat every page load as a new visitor. The first click from
 *     one device in one day is `unique`; the rest are still stored (the raw
 *     number is worth keeping) but are not what the panel reports.
 *
 *   • It does not log an unknown code. An unattributed click is noise and a
 *     cheap way to fill the table.
 */
export function recordClick(input: {
  code: string;
  ip?: string;
  ua?: string;
  landing?: string;
  campaign?: string;
  referer?: string;
  /** True when the visitor is the partner checking their own link. */
  preview?: boolean;
  /**
   * Ad click ids and campaign params captured at first touch. Opaque provider
   * tokens: stored verbatim, never parsed. See `lib/tracking.ts`.
   */
  signals?: ClickSignals;
  /**
   * Where this click stands on cookie consent: `exempt` when the visitor's
   * jurisdiction does not require a banner, null when they were asked and have
   * not answered yet. `setClickConsent()` fills in the answer afterwards.
   *
   * Computed on the SERVER from the geolocation header, never taken from the
   * request body — an endpoint anyone can POST to is not a source of truth
   * about the law.
   */
  consent?: string | null;
}): ClickResult {
  if (input.preview)
    return { recorded: false, unique: false, reason: "preview" };

  const code = String(input.code || "")
    .trim()
    .toUpperCase();
  if (!code) return { recorded: false, unique: false, reason: "no_code" };

  const ok = db
    .prepare(`SELECT 1 AS ok FROM affiliates WHERE upper(code) = ?`)
    .get(code) as { ok?: number } | undefined;
  if (!ok) return { recorded: false, unique: false, reason: "unknown_code" };

  const ts = Date.now();
  const day = dayKeyOf(ts);
  const ip = String(input.ip || "").slice(0, 64);
  const ua = String(input.ua || "").slice(0, 400);
  const device = deviceKey(ip, ua);

  // First from this device today? A blank device key means we could identify
  // nothing at all, so treat it as unique rather than lumping every anonymous
  // visitor into one bucket (which would under-count badly behind a proxy that
  // strips both headers).
  let unique = true;
  if (device) {
    const seen = db
      .prepare(
        `SELECT 1 AS ok FROM affiliate_clicks
          WHERE code = ? AND day = ? AND device = ? LIMIT 1`,
      )
      .get(code, day, device) as { ok?: number } | undefined;
    unique = !seen;
  }

  const inserted = db
    .prepare(
      `INSERT INTO affiliate_clicks
       (code, ts, ip, ua, landing, campaign, referer, day, device, is_unique, signals, consent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      code,
      ts,
      ip,
      ua,
      String(input.landing || "").slice(0, 80),
      String(input.campaign || "").slice(0, 80),
      String(input.referer || "").slice(0, 300),
      day,
      device,
      unique ? 1 : 0,
      serialiseSignals(input.signals),
      input.consent === "exempt" ? "exempt" : null,
    );
  return {
    recorded: true,
    unique,
    id: Number(inserted.lastInsertRowid || 0) || undefined,
  };
}

/**
 * Write the visitor's answer onto the click it belongs to.
 *
 * The click is recorded the moment the page renders, which is BEFORE the banner
 * has been answered — so at click time there is no decision to store. This is
 * the second half: the banner calls it once the visitor chooses.
 *
 * Only ever fills a blank. A row already marked `exempt` stays exempt, and an
 * existing answer is never overwritten, so a replayed request cannot flip a
 * recorded refusal into permission.
 */
export function setClickConsent(
  clickId: number,
  decision: "granted" | "denied",
): boolean {
  if (!Number.isInteger(clickId) || clickId <= 0) return false;
  const res = db
    .prepare(
      `UPDATE affiliate_clicks SET consent = ?
        WHERE id = ? AND (consent IS NULL OR consent = '')`,
    )
    .run(decision, clickId);
  return Number(res.changes || 0) > 0;
}

export type ClickSource = {
  /** Campaign tag, or the landing page when the link carried no tag. */
  key: string;
  clicks: number;
  unique: number;
  signups: number;
  deposited: number;
  lastClick: number | null;
};

export type ClickRecent = {
  ts: number;
  landing: string;
  campaign: string;
  unique: boolean;
  converted: boolean;
  referer: string;
};

export type ClickStats = {
  clicks: number;
  unique: number;
  /** Windowed totals, for "last 30 days" style headers. */
  windowClicks: number;
  windowUnique: number;
  sources: ClickSource[];
  pages: ClickSource[];
  recent: ClickRecent[];
  /** Every tag this partner has used, for reuse in the link builder. */
  tags: { tag: string; clicks: number; lastClick: number | null }[];
};

/**
 * Everything the Links page needs to answer "what is working?".
 *
 * Two numbers are reported side by side and never merged: `clicks` is every page
 * load, `unique` is the first load per device per day. A partner refreshing
 * their own link moves the first and not the second, which is exactly the
 * distinction that stops them misreading their own testing as traffic.
 */
export function clickStats(affiliateId: string, days = 30): ClickStats {
  const aff = affiliateById(affiliateId);
  const empty: ClickStats = {
    clicks: 0,
    unique: 0,
    windowClicks: 0,
    windowUnique: 0,
    sources: [],
    pages: [],
    recent: [],
    tags: [],
  };
  if (!aff) return empty;

  const code = aff.code;
  const from = Date.now() - days * 86400_000;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(is_unique),0) AS u,
              COALESCE(SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END),0) AS wn,
              COALESCE(SUM(CASE WHEN ts >= ? THEN is_unique ELSE 0 END),0) AS wu
         FROM affiliate_clicks WHERE code = ?`,
    )
    .get(from, from, code) as any;

  const byCampaign = db
    .prepare(
      `SELECT COALESCE(NULLIF(campaign,''),'(none)') AS k, COUNT(*) AS n,
              COALESCE(SUM(is_unique),0) AS u, MAX(ts) AS last
         FROM affiliate_clicks WHERE code = ? GROUP BY k`,
    )
    .all(code) as any[];

  const byPage = db
    .prepare(
      `SELECT COALESCE(NULLIF(landing,''),'(direct)') AS k, COUNT(*) AS n,
              COALESCE(SUM(is_unique),0) AS u, MAX(ts) AS last
         FROM affiliate_clicks WHERE code = ? GROUP BY k`,
    )
    .all(code) as any[];

  const signupsByCampaign = db
    .prepare(
      `SELECT COALESCE(NULLIF(campaign,''),'(none)') AS k, COUNT(*) AS n,
              COALESCE(SUM(deposited),0) AS d
         FROM affiliate_referrals WHERE affiliate_id = ? GROUP BY k`,
    )
    .all(affiliateId) as any[];

  const signupsByPage = db
    .prepare(
      `SELECT COALESCE(NULLIF(landing,''),'(direct)') AS k, COUNT(*) AS n,
              COALESCE(SUM(deposited),0) AS d
         FROM affiliate_referrals WHERE affiliate_id = ? GROUP BY k`,
    )
    .all(affiliateId) as any[];

  const merge = (rows: any[], signups: any[]): ClickSource[] => {
    const s = new Map(signups.map((r) => [str(r.k), r]));
    return (
      rows
        .map((r) => ({
          key: str(r.k),
          clicks: num(r.n),
          unique: num(r.u),
          signups: num(s.get(str(r.k))?.n),
          deposited: num(s.get(str(r.k))?.d),
          lastClick: r.last ? num(r.last) : null,
        }))
        // Busiest first, but unique clicks break the tie — a channel that sends
        // the same person fifty times should not outrank a real audience.
        .sort((a, b) => b.unique - a.unique || b.clicks - a.clicks)
    );
  };

  const recent = (
    db
      .prepare(
        `SELECT ts, landing, campaign, is_unique, user_id, referer
           FROM affiliate_clicks WHERE code = ? ORDER BY ts DESC LIMIT 12`,
      )
      .all(code) as any[]
  ).map((r) => ({
    ts: num(r.ts),
    landing: str(r.landing),
    campaign: str(r.campaign),
    unique: num(r.is_unique) === 1,
    converted: !!r.user_id,
    referer: str(r.referer),
  }));

  return {
    clicks: num(totals?.n),
    unique: num(totals?.u),
    windowClicks: num(totals?.wn),
    windowUnique: num(totals?.wu),
    sources: merge(byCampaign, signupsByCampaign),
    pages: merge(byPage, signupsByPage),
    recent,
    // '(none)' is not a tag, so it is not offered back for reuse.
    tags: byCampaign
      .filter((r) => str(r.k) && str(r.k) !== "(none)")
      .map((r) => ({
        tag: str(r.k),
        clicks: num(r.n),
        lastClick: r.last ? num(r.last) : null,
      }))
      .sort((a, b) => (b.lastClick || 0) - (a.lastClick || 0))
      .slice(0, 40),
  };
}

// ── partner requests ────────────────────────────────────────────────────────

export type PartnerRequest = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  audience: string;
  status: "open" | "done" | "declined";
  note: string;
  createdAt: number;
  decidedAt: number | null;
};

const shapeRequest = (r: any): PartnerRequest => ({
  id: str(r.id),
  kind: str(r.kind, "landing_page"),
  title: str(r.title),
  detail: str(r.detail),
  audience: str(r.audience),
  status: str(r.status, "open") as PartnerRequest["status"],
  note: str(r.note),
  createdAt: num(r.created_at),
  decidedAt: r.decided_at ? num(r.decided_at) : null,
});

/**
 * A partner asks for something — usually a landing page.
 *
 * Rate limited to three open requests, because an unbounded box in a partner
 * panel becomes a support queue with no queue.
 */
export function createRequest(input: {
  affiliateId: string;
  kind?: string;
  title: string;
  detail?: string;
  audience?: string;
}) {
  const aff = affiliateById(String(input.affiliateId));
  if (!aff)
    return { ok: false as const, error: "Affiliate not found", status: 404 };
  if (aff.status !== "approved")
    return {
      ok: false as const,
      error: "Your account is not active",
      status: 403,
    };

  const title = String(input.title || "").trim();
  if (title.length < 4)
    return {
      ok: false as const,
      error: "Give the request a short title (at least 4 characters)",
      status: 400,
    };

  const open = db
    .prepare(
      `SELECT COUNT(*) AS n FROM affiliate_requests
        WHERE affiliate_id = ? AND status = 'open'`,
    )
    .get(aff.id) as { n?: number } | undefined;
  if (num(open?.n) >= 3)
    return {
      ok: false as const,
      error:
        "You already have three open requests. Wait for one to be answered before adding another.",
      status: 409,
    };

  const id = `RQ-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  db.prepare(
    `INSERT INTO affiliate_requests
       (id, affiliate_id, kind, title, detail, audience, status, created_at)
     VALUES (?,?,?,?,?,?, 'open', ?)`,
  ).run(
    id,
    aff.id,
    ["landing_page", "creative", "other"].includes(String(input.kind))
      ? String(input.kind)
      : "landing_page",
    title.slice(0, 120),
    String(input.detail || "").slice(0, 600),
    String(input.audience || "").slice(0, 400),
    Date.now(),
  );
  return { ok: true as const, id, requests: requestsFor(aff.id) };
}

export function requestsFor(affiliateId: string, limit = 30): PartnerRequest[] {
  const rows = db
    .prepare(
      `SELECT * FROM affiliate_requests WHERE affiliate_id = ?
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`,
    )
    .all(String(affiliateId), limit) as any[];
  return rows.map(shapeRequest);
}

/** Operator view. Returns the requesting partner alongside each row. */
export function listRequests(status?: string, limit = 100) {
  const where = status && status !== "all" ? `WHERE r.status = ?` : "";
  const rows = db
    .prepare(
      `SELECT r.*, a.name AS aff_name, a.email AS aff_email, a.code AS aff_code
         FROM affiliate_requests r
         LEFT JOIN affiliates a ON a.id = r.affiliate_id
         ${where}
        ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT ?`,
    )
    .all(...(where ? [String(status), limit] : [limit])) as any[];
  return rows.map((r) => ({
    ...shapeRequest(r),
    affiliateId: str(r.affiliate_id),
    affiliateName: str(r.aff_name, "(deleted affiliate)"),
    affiliateEmail: str(r.aff_email),
    affiliateCode: str(r.aff_code),
  }));
}

export function decideRequest(input: {
  id: string;
  status: "done" | "declined";
  note?: string;
  actor?: string | null;
}) {
  const id = String(input.id || "");
  const row = db
    .prepare(`SELECT * FROM affiliate_requests WHERE id = ?`)
    .get(id) as any;
  if (!row)
    return { ok: false as const, error: "Request not found", status: 404 };
  if (str(row.status) !== "open")
    return {
      ok: false as const,
      error: "This request has already been decided",
      status: 409,
    };

  const note = String(input.note || "").trim();
  // A decline is read by the partner, so it has to say why.
  if (input.status === "declined" && !note)
    return {
      ok: false as const,
      error: "Add a reason — the partner sees this",
      status: 400,
    };

  db.prepare(
    `UPDATE affiliate_requests
        SET status = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
  ).run(
    input.status,
    note.slice(0, 400),
    Date.now(),
    input.actor ? String(input.actor).slice(0, 128) : null,
    id,
  );
  const fresh = db
    .prepare(`SELECT * FROM affiliate_requests WHERE id = ?`)
    .get(id);
  return { ok: true as const, request: shapeRequest(fresh) };
}

/**
 * The one place the two halves of the system disagree about what a user id is.
 *
 * The funding ledger keys money on `u-<users.id>` (`trade_deposits.user_id`,
 * `payment_orders.user_id`) because that is the account handle the rest of the
 * app passes around. Every table in here keys on the BARE `users.id`, because
 * these rows are joined against `users.id` to resolve a customer's broker
 * client code.
 *
 * `recordDeposit` hands its ledger key straight to `attributeDeposit`, so the
 * lookup below used to ask for `u-1162203688…` in a table that stores
 * `1162203688…`, match nothing, and return without a word. Every real deposit
 * credited the customer and paid the partner NOTHING: the signup was attributed
 * correctly, so the panel showed customers and clicks, and the commission never
 * appeared. Seeded demo commissions all carry bare ids, so they joined fine and
 * made the panel look healthy — which is why this survived a smoke suite.
 *
 * Normalising here rather than at the call sites means any future caller is
 * correct by construction, and it is idempotent for a bare id.
 */
function affiliateUserId(raw: unknown) {
  return String(raw || "")
    .trim()
    .replace(/^u-/, "");
}

/**
 * Exported so other modules can look a click up by its owner.
 *
 * `affiliate_clicks.user_id` stores the BARE id, not the `u-` form — that
 * mismatch is the bug described above, and anything querying that column has to
 * normalise the same way or it will match nothing and say so quietly.
 */
export { affiliateUserId };

/**
 * Why an attribution was refused. Every one of these used to be a bare `null`,
 * which is indistinguishable from "no referral was presented at all" — so a
 * partner whose links were credited to nobody saw clicks, saw no customers, and
 * had no way to find out that anything had gone wrong.
 */
export type AttributionRefusal =
  | "no_user"
  | "unknown_code"
  | "not_approved"
  | "self_referral"
  | "already_owned";

export type AttributionResult =
  | { ok: true; affiliate: Affiliate }
  | { ok: false; reason: AttributionRefusal };

/**
 * Bind a new customer to an affiliate. Permanent and one-time.
 *
 * First binding wins and is never overwritten: if a customer is already owned
 * by another partner, a later signup cannot steal them by replaying a link.
 * Self-referral (the partner signing up as a trader on their own code) is
 * refused as well.
 */
export function attributeSignup(input: {
  userId: string;
  code: string;
  landing?: string;
  campaign?: string;
}): AttributionResult {
  const userId = affiliateUserId(input.userId);
  if (!userId) return { ok: false, reason: "no_user" };

  const aff = affiliateByCode(String(input.code || ""));
  if (!aff) return { ok: false, reason: "unknown_code" };
  if (aff.status !== "approved") return { ok: false, reason: "not_approved" };

  const mine = db
    .prepare(`SELECT 1 AS ok FROM affiliates WHERE id = ?`)
    .get(userId) as { ok?: number } | undefined;
  // an affiliate may not be their own customer
  if (mine) return { ok: false, reason: "self_referral" };

  const already = db
    .prepare(`SELECT affiliate_id FROM affiliate_referrals WHERE user_id = ?`)
    .get(userId) as { affiliate_id?: string } | undefined;
  if (already) return { ok: false, reason: "already_owned" };

  db.prepare(
    `INSERT INTO affiliate_referrals
       (user_id, affiliate_id, code, landing, campaign, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    userId,
    aff.id,
    aff.code,
    String(input.landing || "").slice(0, 80),
    String(input.campaign || "").slice(0, 80),
    Date.now(),
  );
  // Mark the most recent click from this code as converted, so the click→signup
  // funnel is not off by the difference between clicks and signups.
  db.prepare(
    `UPDATE affiliate_clicks SET user_id = ?
      WHERE id = (SELECT id FROM affiliate_clicks
                   WHERE code = ? AND user_id IS NULL
                   ORDER BY ts DESC LIMIT 1)`,
  ).run(userId, aff.code);
  return { ok: true, affiliate: aff };
}

// ── commercial terms, over time ─────────────────────────────────────────────

/** Rupees rounded to paise. One definition, so every figure rounds the same. */
export function money(n: unknown) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type CommissionTerms = {
  model: string;
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
  planId: string | null;
  /** Where the answer came from, so any disputed number can be traced. */
  source: "history" | "current";
  since: number | null;
};

function termsFromRow(row: any): CommissionTerms {
  return {
    model: str(row.model, "deposit"),
    depositRate: num(row.deposit_rate),
    revRate: num(row.rev_rate),
    holdDays: num(row.hold_days, 21),
    minPayout: num(row.min_payout, 1000),
    planId: row.plan_id ? str(row.plan_id) : null,
    source: "history",
    since: num(row.at),
  };
}

/**
 * Record the terms an affiliate is on, as of now. Append-only, never updated.
 *
 * Called whenever the commercial terms change. Without this, "what was this
 * partner's rate in March" has exactly one answer — today's — and applying it
 * to March's money is how a reconciliation pays the wrong amount with total
 * confidence.
 */
export function recordTerms(input: {
  affiliateId: string;
  actor?: string | null;
  reason?: string | null;
}) {
  const aff = affiliateById(String(input.affiliateId || ""));
  if (!aff) return null;
  db.prepare(
    `INSERT INTO affiliate_terms_history
       (affiliate_id, at, model, deposit_rate, rev_rate, hold_days, min_payout,
        plan_id, actor, reason)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    aff.id,
    Date.now(),
    aff.model,
    aff.depositRate,
    aff.revRate,
    aff.holdDays,
    aff.minPayout,
    aff.planId,
    input.actor ? String(input.actor).slice(0, 128) : null,
    input.reason ? String(input.reason).slice(0, 200) : null,
  );
  return aff;
}

/**
 * The terms that were in force at a moment in time.
 *
 * Falls back in a defined order rather than guessing: the latest entry at or
 * before the moment; else the EARLIEST entry we have (the terms they started
 * on, which is the closest thing to the truth for a deposit older than our
 * records); else the affiliate's current terms, flagged as such so a caller
 * knows the answer is an assumption.
 */
export function termsAt(
  affiliateId: string,
  at: number,
): CommissionTerms | null {
  const id = String(affiliateId || "");
  if (!id) return null;

  const row = db
    .prepare(
      `SELECT * FROM affiliate_terms_history
        WHERE affiliate_id = ? AND at <= ?
        ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .get(id, num(at)) as any;
  if (row) return termsFromRow(row);

  const earliest = db
    .prepare(
      `SELECT * FROM affiliate_terms_history
        WHERE affiliate_id = ? ORDER BY at ASC, id ASC LIMIT 1`,
    )
    .get(id) as any;
  if (earliest) return termsFromRow(earliest);

  const aff = affiliateById(id);
  if (!aff) return null;
  return {
    model: aff.model,
    depositRate: aff.depositRate,
    revRate: aff.revRate,
    holdDays: aff.holdDays,
    minPayout: aff.minPayout,
    planId: aff.planId,
    source: "current",
    since: null,
  };
}

/**
 * `trade_deposits` and `payment_orders` key money on `u-<id>`; every affiliate
 * table keys on the bare id. These two helpers are the only places that know
 * it, so no caller can get it wrong.
 */
function ledgerKeyOf(raw: unknown) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.startsWith("u-") ? s : `u-${s}`;
}

/**
 * The customer's first deposit of money that actually arrived.
 *
 * Answered from the LEDGER, never from a counter. The counter decides whether a
 * partner is paid the first-deposit rate, so a counter that drifts silently
 * overpays; the ledger simply is the money, so this cannot drift.
 */
function firstRealDepositId(ledgerKey: string): number | null {
  const r = db
    .prepare(
      `SELECT id FROM trade_deposits
        WHERE user_id = ? AND method IN ('admin','gateway')
        ORDER BY ts ASC, id ASC LIMIT 1`,
    )
    .get(ledgerKey) as { id?: number } | undefined;
  return r?.id == null ? null : Number(r.id);
}

/**
 * Make a referral's cached `deposited` figure equal the ledger again.
 *
 * Recomputed, never incremented. An increment is only correct if it ran exactly
 * once per deposit; the day it doesn't, the number is wrong forever and there is
 * nothing to compare it against. A recompute is self-healing — whatever went
 * wrong before, the next call repairs it.
 */
export function recomputeReferralDeposits(
  accountId: string,
  ledgerKey: string,
) {
  db.prepare(
    `UPDATE affiliate_referrals
        SET deposited = (
          SELECT COALESCE(SUM(amount), 0) FROM trade_deposits
           WHERE user_id = ? AND method IN ('admin','gateway'))
      WHERE user_id = ?`,
  ).run(ledgerKey, accountId);
}

export type CommissionInput = {
  depositId: number | string;
  userId: string;
  amount: number;
  method: string;
  /** The deposit's own timestamp, so a repaired row is dated by the money. */
  at?: number;
  /** Marks rows written by reconciliation rather than by a live event. */
  reconciled?: boolean;
};

/**
 * Turn a verified deposit into commission rows.
 *
 * Called from `recordDeposit` for admin and gateway money only. `depositId` is
 * the ledger row id and doubles as the idempotency key, so a retried webhook
 * credits the customer once and pays the partner once.
 *
 * THE SAME FUNCTION DOES BOTH LIVE CREDITING AND REPAIR. That is deliberate and
 * it is the point: reconciliation calls this rather than reimplementing the
 * rule, so a repaired commission and a live one are computed by identical code
 * and cannot drift apart. There is one definition of what a partner is owed.
 */
export function attributeDeposit(input: CommissionInput) {
  if (input.method !== "admin" && input.method !== "gateway") return null;

  const accountId = affiliateUserId(input.userId);
  const ledgerKey = ledgerKeyOf(input.userId);
  const base = money(input.amount);
  if (!accountId || !ledgerKey || base <= 0) return null;

  const ref = db
    .prepare(`SELECT affiliate_id FROM affiliate_referrals WHERE user_id = ?`)
    .get(accountId) as { affiliate_id?: string } | undefined;
  if (!ref?.affiliate_id) return null;

  const aff = affiliateById(String(ref.affiliate_id));
  if (!aff) return null;

  const at = num(input.at) || Date.now();
  // Terms as they were WHEN THE MONEY ARRIVED, not as they are today.
  const terms = termsAt(aff.id, at);
  if (!terms) return null;

  const depositId = Number(input.depositId) || 0;
  // Read from the ledger, not from a counter. A deposit with no id cannot be
  // placed in the sequence at all, so it is treated as not-first rather than
  // guessing — that under-credits the bonus rate instead of over-crediting it.
  const isFirst = depositId > 0 && firstRealDepositId(ledgerKey) === depositId;

  // Holdback runs from the money ARRIVING, not from when the row was written.
  //
  // For a live deposit those are the same moment. For a repaired row it matters
  // a great deal: a March deposit with a 21-day hold has already served its
  // holdback, so `releaseDue` will correctly make it available at once rather
  // than making the partner serve a second holdback for a delay that was our
  // fault. The stored date is the TRUE one, so the row still reads honestly.
  const hold = at + Math.max(0, terms.holdDays) * 86400_000;

  let written = 0;
  const add = (
    rate: number,
    kind: "Deposit %" | "Recurring share",
    tag: string,
  ) => {
    if (!(rate > 0)) return;
    const amount = money(base * (rate / 100));
    if (amount <= 0) return;
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO affiliate_commissions
           (affiliate_id, user_id, source, idem, base_amount, rate, amount,
            status, hold_until, created_at, note, model, plan_id, hold_days,
            deposit_id, earned_at, reconciled)
         VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        aff.id,
        accountId,
        tag,
        `dep:${depositId}:${tag}`,
        base,
        rate,
        amount,
        hold,
        Date.now(),
        kind,
        terms.model,
        terms.planId,
        terms.holdDays,
        depositId || null,
        at,
        input.reconciled ? 1 : 0,
      );
    written += Number(res.changes || 0);
  };

  // The set is closed and validated on every write path, so an unrecognised
  // model should be unreachable. If one ever appears — a hand-edited row, a
  // restored backup — apply the MOST RESTRICTIVE rule rather than falling
  // through to hybrid.
  //
  // The direction of failure matters. Paying too little is recoverable: the
  // partner is owed the difference and reconciliation exists to find and settle
  // exactly that. Paying too much means clawing money back from someone who has
  // already been told it was theirs, which is a far worse problem to have.
  const model: CommissionModel = isCommissionModel(terms.model)
    ? terms.model
    : "deposit";
  if (!isCommissionModel(terms.model))
    console.warn(
      `[affiliate] unrecognised commission model "${terms.model}" on ${aff.code} — applying the most restrictive rule (first deposit only)`,
    );

  if (model === "deposit") {
    if (isFirst) add(terms.depositRate, "Deposit %", "first");
  } else if (model === "revshare") {
    add(terms.revRate, "Recurring share", "recur");
  } else {
    // hybrid: the bonus on the first deposit, then the recurring share forever
    if (isFirst) add(terms.depositRate, "Deposit %", "first");
    add(terms.revRate, "Recurring share", "recur");
  }

  // Keep the cached figure equal to the ledger, whether or not we wrote a row.
  recomputeReferralDeposits(accountId, ledgerKey);
  return { written, isFirst, terms };
}

// ── reconciliation ──────────────────────────────────────────────────────────

export type ReconcileIssue = {
  kind:
    | "missing"
    | "amount_mismatch"
    | "orphan"
    | "counter_drift"
    | "assumed_terms"
    | "no_terms";
  affiliateId: string;
  userId: string;
  depositId: number | null;
  tag: string | null;
  expected: number | null;
  actual: number | null;
  detail: string;
};

export type ReconcileReport = {
  mode: "dry-run" | "applied";
  affiliatesScanned: number;
  referralsScanned: number;
  depositsScanned: number;
  missing: number;
  missingAmount: number;
  mismatched: number;
  orphaned: number;
  drifted: number;
  assumedTerms: number;
  repaired: number;
  repairedAmount: number;
  truncated: boolean;
  issues: ReconcileIssue[];
};

/**
 * Replay the deposit ledger and check the commission ledger against it.
 *
 * WHY THIS EXISTS. Every other safeguard in this file assumes the write
 * happened. This is the one that does not: it recomputes what a partner is owed
 * from the raw facts — the deposits that actually arrived, and the terms that
 * were actually in force at the time — and compares that against the commission
 * rows. Anything missing is an underpayment nobody would otherwise notice, and
 * it is exactly the failure that hid here for weeks: the partner sees clicks and
 * customers, so nothing looks broken, and only the money is absent.
 *
 * It is safe to run at any time and safe to run twice. Repairs go through
 * `attributeDeposit`, the same function the live path uses, and the ledger's
 * unique index on `idem` means a second run inserts nothing. Rows are never
 * deleted or rewritten: a wrong amount is REPORTED, not silently corrected,
 * because changing money that may already have been paid out is a human
 * decision, not a batch job's.
 *
 * NOTE ON RELEASE: a repaired row for an old deposit carries the true holdback
 * date, so it is already past its hold and becomes withdrawable immediately.
 * That is correct — the money was owed back then — but it does mean an operator
 * running `apply` on a long backlog is releasing real money. Dry-run first.
 */
export function reconcileCommissions(
  opts: { affiliateId?: string; apply?: boolean; limit?: number } = {},
): ReconcileReport {
  const apply = opts.apply === true;
  const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500));
  const MAX_ISSUES = 200;

  const report: ReconcileReport = {
    mode: apply ? "applied" : "dry-run",
    affiliatesScanned: 0,
    referralsScanned: 0,
    depositsScanned: 0,
    missing: 0,
    missingAmount: 0,
    mismatched: 0,
    orphaned: 0,
    drifted: 0,
    assumedTerms: 0,
    repaired: 0,
    repairedAmount: 0,
    truncated: false,
    issues: [],
  };

  const push = (i: ReconcileIssue) => {
    if (report.issues.length < MAX_ISSUES) report.issues.push(i);
    else report.truncated = true;
  };

  const refs = db
    .prepare(
      `SELECT user_id, affiliate_id, deposited FROM affiliate_referrals
        ${opts.affiliateId ? "WHERE affiliate_id = ?" : ""}
        ORDER BY created_at ASC LIMIT ?`,
    )
    .all(...(opts.affiliateId ? [opts.affiliateId, limit] : [limit])) as any[];

  // Rows actually created, measured as a delta on the table.
  //
  // Counting loop iterations instead UNDER-reports a repair: one
  // `attributeDeposit` call writes every tag that applies to a deposit, so by
  // the time the loop reaches the second tag that row already exists and is no
  // longer counted. A dry run would say "400 missing" and the repair that fixed
  // all 400 would claim "300 repaired" — which invites an operator to run it
  // again for the 100 that were never missing.
  const snapshot = () =>
    db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM affiliate_commissions`,
      )
      .get() as { n?: number; t?: number };
  const before = apply ? snapshot() : null;

  const affiliates = new Set<string>();

  for (const ref of refs) {
    const accountId = str(ref.user_id);
    const affiliateId = str(ref.affiliate_id);
    const ledgerKey = ledgerKeyOf(accountId);
    if (!accountId || !affiliateId) continue;
    if (!affiliateById(affiliateId)) continue;

    report.referralsScanned++;
    affiliates.add(affiliateId);

    const deposits = db
      .prepare(
        `SELECT id, ts, amount, method FROM trade_deposits
          WHERE user_id = ? AND method IN ('admin','gateway')
          ORDER BY ts ASC, id ASC`,
      )
      .all(ledgerKey) as any[];

    // The cached figure is a CACHE. If it disagrees with the ledger, the ledger
    // wins, and the disagreement is itself worth reporting — it means a write
    // was lost somewhere and may have other consequences.
    const ledgerTotal = money(deposits.reduce((n, d) => n + num(d.amount), 0));

    // Rows written before the `u-<id>` convention existed are keyed on the bare
    // id. That is real money this lookup cannot see, so a disagreement can mean
    // "the cached figure is wrong" OR "the ledger is under a different key".
    // Those need opposite responses, and guessing wrong either hides money or
    // erases it — so the ambiguity is detected and reported, and the repair is
    // withheld rather than performed blind.
    const legacyTotal = money(
      num(
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(amount),0) AS t FROM trade_deposits
                WHERE user_id = ? AND method IN ('admin','gateway')`,
            )
            .get(accountId) as any
        )?.t,
      ),
    );

    if (Math.abs(ledgerTotal - num(ref.deposited)) > 0.009) {
      report.drifted++;
      push({
        kind: "counter_drift",
        affiliateId,
        userId: accountId,
        depositId: null,
        tag: null,
        expected: ledgerTotal,
        actual: num(ref.deposited),
        detail:
          `cached deposited ₹${num(ref.deposited)} vs ledger ₹${ledgerTotal}` +
          (legacyTotal > 0
            ? ` — and ₹${legacyTotal} sits under the legacy bare key "${accountId}",` +
              " so this needs a human decision rather than an automatic repair"
            : ""),
      });
      if (apply && legacyTotal <= 0)
        recomputeReferralDeposits(accountId, ledgerKey);
    }

    // First deposit taken from the ledger's own ordering, matching exactly what
    // `attributeDeposit` uses. Two definitions of "first" would be one too many.
    const firstId = deposits.length ? num(deposits[0].id) : null;

    for (const d of deposits) {
      const depositId = num(d.id);
      const at = num(d.ts);
      const amount = money(d.amount);
      report.depositsScanned++;

      const terms = termsAt(affiliateId, at);
      if (!terms) {
        push({
          kind: "no_terms",
          affiliateId,
          userId: accountId,
          depositId,
          tag: null,
          expected: null,
          actual: null,
          detail: "no terms could be resolved for this deposit",
        });
        continue;
      }
      // Reconciling with today's rate is precisely the risk worth flagging.
      if (terms.source === "current") {
        report.assumedTerms++;
        push({
          kind: "assumed_terms",
          affiliateId,
          userId: accountId,
          depositId,
          tag: null,
          expected: null,
          actual: null,
          detail:
            "no terms history — assumed the CURRENT rate applies to this deposit",
        });
      }

      const isFirst = firstId === depositId;
      const wanted: { tag: string; rate: number; kind: string }[] = [];
      if (terms.model === "deposit") {
        if (isFirst && terms.depositRate > 0)
          wanted.push({
            tag: "first",
            rate: terms.depositRate,
            kind: "Deposit %",
          });
      } else if (terms.model === "revshare") {
        if (terms.revRate > 0)
          wanted.push({
            tag: "recur",
            rate: terms.revRate,
            kind: "Recurring share",
          });
      } else {
        if (isFirst && terms.depositRate > 0)
          wanted.push({
            tag: "first",
            rate: terms.depositRate,
            kind: "Deposit %",
          });
        if (terms.revRate > 0)
          wanted.push({
            tag: "recur",
            rate: terms.revRate,
            kind: "Recurring share",
          });
      }

      for (const w of wanted) {
        const want = money(amount * (w.rate / 100));
        if (want <= 0) continue;
        const idem = `dep:${depositId}:${w.tag}`;
        const have = db
          .prepare(`SELECT amount FROM affiliate_commissions WHERE idem = ?`)
          .get(idem) as { amount?: number } | undefined;

        if (!have) {
          report.missing++;
          report.missingAmount = money(report.missingAmount + want);
          push({
            kind: "missing",
            affiliateId,
            userId: accountId,
            depositId,
            tag: w.tag,
            expected: want,
            actual: null,
            detail: `${terms.model} · ${w.kind} @ ${w.rate}% on ₹${amount}`,
          });
          if (apply) {
            attributeDeposit({
              depositId,
              userId: ledgerKey,
              amount,
              method: str(d.method, "admin"),
              at,
              reconciled: true,
            });
          }
        } else if (Math.abs(num(have.amount) - want) > 0.009) {
          // Reported, never auto-corrected. The row may already be paid, and
          // rewriting money that has left the building is not a batch job's call.
          report.mismatched++;
          push({
            kind: "amount_mismatch",
            affiliateId,
            userId: accountId,
            depositId,
            tag: w.tag,
            expected: want,
            actual: num(have.amount),
            detail: `${idem} — stored ₹${num(have.amount)}, ledger says ₹${want}`,
          });
        }
      }
    }
  }

  // Commissions pointing at a deposit that is not in the ledger at all. Never
  // deleted automatically — a human looks at each one.
  const orphans = db
    .prepare(
      `SELECT c.id, c.deposit_id, c.affiliate_id, c.user_id, c.amount
         FROM affiliate_commissions c
        WHERE c.deposit_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM trade_deposits d WHERE d.id = c.deposit_id)
        ${opts.affiliateId ? "AND c.affiliate_id = ?" : ""}
        LIMIT 100`,
    )
    .all(...(opts.affiliateId ? [opts.affiliateId] : [])) as any[];
  for (const o of orphans) {
    report.orphaned++;
    push({
      kind: "orphan",
      affiliateId: str(o.affiliate_id),
      userId: str(o.user_id),
      depositId: num(o.deposit_id),
      tag: null,
      expected: null,
      actual: num(o.amount),
      detail: `commission #${num(o.id)} references deposit ${num(o.deposit_id)} which is not in the ledger`,
    });
  }

  report.affiliatesScanned = affiliates.size;

  // What the repair actually wrote, not how many times it was asked.
  if (before) {
    const after = snapshot();
    report.repaired = Math.max(0, Number(after.n) - Number(before.n));
    report.repairedAmount = money(num(after.t) - num(before.t));
  }
  return report;
}

/**
 * Flip commissions whose holdback has elapsed.
 *
 * One set-based UPDATE. The previous version SELECTed the due rows and then
 * issued an UPDATE per row, and it is called several times per partner per page
 * — so a busy programme spent most of a dashboard render rewriting the same
 * rows one at a time. The WHERE clause makes it idempotent: a row already
 * `approved` is no longer `pending` and cannot be picked up twice.
 */
export function releaseDue(affiliateId?: string) {
  const now = Date.now();
  const res = db
    .prepare(
      `UPDATE affiliate_commissions SET status = 'approved', decided_at = ?
        WHERE status = 'pending' AND hold_until IS NOT NULL AND hold_until <= ?
        ${affiliateId ? "AND affiliate_id = ?" : ""}`,
    )
    .run(...(affiliateId ? [now, now, affiliateId] : [now, now]));
  return Number(res.changes || 0);
}

// ── money ───────────────────────────────────────────────────────────────────

function sumOf(affiliateId: string, statuses: string[]) {
  const marks = statuses.map(() => "?").join(",");
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM affiliate_commissions
        WHERE affiliate_id = ? AND status IN (${marks})`,
    )
    .get(affiliateId, ...statuses) as { t?: number } | undefined;
  return num(r?.t);
}

/** Money that has been promised but is still inside its holdback window. */
export function pendingTotal(affiliateId: string) {
  releaseDue(affiliateId);
  return sumOf(affiliateId, ["pending"]);
}

/** Money already requested or sent, which must not be offered again. */
export function committedTotal(affiliateId: string) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM affiliate_payouts
        WHERE affiliate_id = ? AND status IN ('requested','approved','paid')`,
    )
    .get(affiliateId) as { t?: number } | undefined;
  return num(r?.t);
}

/**
 * Everything a partner has earned, paid or not.
 *
 * Sums commission rows, which never leave the ledger — a paid commission is
 * still earned money, and a rejected payout puts its commission straight back
 * into `available` because `approved` is untouched.
 */
export function earnedTotal(affiliateId: string) {
  releaseDue(affiliateId);
  return sumOf(affiliateId, ["pending", "approved", "paid"]);
}

export function reversedTotal(affiliateId: string) {
  return sumOf(affiliateId, ["reversed"]);
}

/**
 * Money that has actually left the building.
 *
 * Read from `affiliate_payouts`, NOT from commission rows. A commission stays
 * `approved` for its whole life; it is the payout that carries the paid/rejected
 * state, because a payout is what moves money and a commission is only what was
 * owed. Summing commission rows here read ₹0 forever — which is exactly the bug
 * a partner would notice first: "you say you paid me, and your own page says
 * paid, but the total is zero."
 */
export function paidTotal(affiliateId: string) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM affiliate_payouts
        WHERE affiliate_id = ? AND status = 'paid'`,
    )
    .get(affiliateId) as { t?: number } | undefined;
  return num(r?.t);
}

/** Withdrawable right now: released money minus everything already committed. */
export function availableTotal(affiliateId: string) {
  releaseDue(affiliateId);
  const released = sumOf(affiliateId, ["approved"]);
  return Math.max(
    0,
    Math.round((released - committedTotal(affiliateId)) * 100) / 100,
  );
}

export function commissionsFor(affiliateId: string, limit = 100): Commission[] {
  releaseDue(affiliateId);
  const base = db
    .prepare(
      `SELECT id, note, amount, base_amount, rate, status, created_at, hold_until, user_id
         FROM affiliate_commissions WHERE affiliate_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(affiliateId, limit) as any[];
  const codes = customerCodes(base.map((r) => str(r.user_id)).filter(Boolean));
  return base.map((r) => ({
    id: num(r.id),
    kind: (str(r.note, "Commission") as Commission["kind"]) || "Commission",
    amount: num(r.amount),
    base: num(r.base_amount),
    rate: num(r.rate),
    status: str(r.status, "pending") as Commission["status"],
    createdAt: num(r.created_at),
    releaseAt: r.hold_until ? num(r.hold_until) : null,
    customer: codes.get(str(r.user_id)) || "—",
  }));
}

/** Broker client codes for a set of user ids, so the partner sees TK267X9Q4. */
function customerCodes(ids: string[]) {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)].slice(0, 500);
  if (!uniq.length) return out;
  const marks = uniq.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, COALESCE(NULLIF(client_code,''), id) AS code
         FROM users WHERE id IN (${marks})`,
    )
    .all(...uniq) as any[];
  for (const r of rows) out.set(str(r.id), str(r.code));
  return out;
}

export type ReferralRow = {
  code: string;
  joinedAt: number;
  deposited: number;
  earned: number;
  pending: number;
  country: string;
  landing: string;
  campaign: string;
};

export function referralsFor(affiliateId: string, limit = 200): ReferralRow[] {
  const rows = db
    .prepare(
      `SELECT r.user_id, r.created_at, r.deposited, r.landing, r.campaign
         FROM affiliate_referrals r WHERE r.affiliate_id = ?
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(affiliateId, limit) as any[];
  if (!rows.length) return [];

  const ids = rows.map((r) => str(r.user_id));
  const codes = customerCodes(ids);
  const marks = ids.map(() => "?").join(",");
  const pay = db
    .prepare(
      `SELECT user_id, status, COALESCE(SUM(amount),0) AS t
         FROM affiliate_commissions WHERE user_id IN (${marks})
        GROUP BY user_id, status`,
    )
    .all(...ids) as any[];
  const earned = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const p of pay) {
    const uid = str(p.user_id);
    const t = num(p.t);
    if (str(p.status) === "reversed") continue;
    earned.set(uid, num(earned.get(uid)) + t);
    if (str(p.status) === "pending")
      pending.set(uid, num(pending.get(uid)) + t);
  }

  return rows.map((r) => {
    const uid = str(r.user_id);
    return {
      code: codes.get(uid) || "—",
      joinedAt: num(r.created_at),
      deposited: num(r.deposited),
      earned: earned.get(uid) || 0,
      pending: pending.get(uid) || 0,
      country: "India",
      landing: str(r.landing),
      campaign: str(r.campaign),
    };
  });
}

// ── payout destinations ─────────────────────────────────────────────────────

export type PayoutAccount = {
  id: string;
  kind: "upi" | "bank" | "usdt";
  label: string;
  holder: string;
  upiId: string;
  accountTail: string;
  ifsc: string;
  bankName: string;
  usdtAddress: string;
  usdtNetwork: string;
  isDefault: boolean;
};

const shapeAcct = (r: any): PayoutAccount => ({
  id: str(r.id),
  kind: (str(r.kind, "upi") as PayoutAccount["kind"]) || "upi",
  label: str(r.label),
  holder: str(r.holder),
  upiId: str(r.upi_id),
  accountTail: str(r.account_tail),
  ifsc: str(r.ifsc),
  bankName: str(r.bank_name),
  usdtAddress: str(r.usdt_address),
  usdtNetwork: str(r.usdt_network),
  isDefault: num(r.is_default) === 1,
});

export function payoutAccounts(affiliateId: string): PayoutAccount[] {
  const rows = db
    .prepare(
      `SELECT * FROM affiliate_payout_accounts WHERE affiliate_id = ?
        ORDER BY is_default DESC, created_at ASC`,
    )
    .all(affiliateId) as any[];
  return rows.map(shapeAcct);
}

export function addPayoutAccount(input: {
  affiliateId: string;
  kind: string;
  label?: string;
  holder?: string;
  upiId?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  usdtAddress?: string;
  usdtNetwork?: string;
  makeDefault?: boolean;
}) {
  const kind = String(input.kind || "");
  if (!["upi", "bank", "usdt"].includes(kind))
    return {
      ok: false as const,
      error: "Choose UPI, bank or USDT",
      status: 400,
    };

  const digits = (v: unknown) => String(v || "").replace(/\D/g, "");
  let payload: Partial<PayoutAccount> & { accountTail?: string } = {};

  if (kind === "upi") {
    const upi = String(input.upiId || "").trim();
    if (!/^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/.test(upi))
      return {
        ok: false as const,
        error: "Enter a valid UPI ID (name@bank)",
        status: 400,
      };
    payload = {
      upiId: upi,
      holder: String(input.holder || "")
        .trim()
        .slice(0, 80),
    };
  } else if (kind === "bank") {
    const acct = digits(input.accountNumber);
    if (acct.length < 9 || acct.length > 18)
      return {
        ok: false as const,
        error: "Enter a valid account number",
        status: 400,
      };
    const ifsc = String(input.ifsc || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
      return {
        ok: false as const,
        error: "Enter a valid IFSC code",
        status: 400,
      };
    payload = {
      accountTail: acct.slice(-4),
      // Only the last four digits are kept. A payout run needs the tail to
      // confirm the right account was paid; it does not need the full number.
      ifsc,
      bankName: String(input.bankName || "")
        .trim()
        .slice(0, 80),
      holder: String(input.holder || "")
        .trim()
        .slice(0, 80),
    };
  } else {
    const addr = String(input.usdtAddress || "").trim();
    if (addr.length < 20)
      return {
        ok: false as const,
        error: "Enter a valid USDT wallet address",
        status: 400,
      };
    const net = String(input.usdtNetwork || "TRC20")
      .trim()
      .toUpperCase();
    payload = {
      usdtAddress: addr.slice(0, 120),
      usdtNetwork: net.slice(0, 24),
    };
  }

  const id = `pa_${randomBytes(8).toString("hex")}`;
  const first = payoutAccounts(String(input.affiliateId)).length === 0;
  const makeDefault = input.makeDefault || first;
  if (makeDefault)
    db.prepare(
      `UPDATE affiliate_payout_accounts SET is_default = 0 WHERE affiliate_id = ?`,
    ).run(String(input.affiliateId));

  db.prepare(
    `INSERT INTO affiliate_payout_accounts
       (id, affiliate_id, kind, label, holder, upi_id, account_tail, ifsc,
        bank_name, usdt_address, usdt_network, is_default, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    String(input.affiliateId),
    kind,
    String(input.label || "").slice(0, 60),
    payload.holder || "",
    payload.upiId || "",
    payload.accountTail || "",
    payload.ifsc || "",
    payload.bankName || "",
    payload.usdtAddress || "",
    payload.usdtNetwork || "",
    makeDefault ? 1 : 0,
    Date.now(),
  );
  return {
    ok: true as const,
    id,
    accounts: payoutAccounts(String(input.affiliateId)),
  };
}

export function removePayoutAccount(affiliateId: string, id: string) {
  const used = db
    .prepare(
      `SELECT 1 AS ok FROM affiliate_payouts
        WHERE account_id = ? AND status IN ('requested','approved')`,
    )
    .get(id) as { ok?: number } | undefined;
  if (used)
    return {
      ok: false as const,
      error: "This destination is used by a payout still being processed",
      status: 409,
    };
  db.prepare(
    `DELETE FROM affiliate_payout_accounts WHERE id = ? AND affiliate_id = ?`,
  ).run(id, affiliateId);
  return { ok: true as const, accounts: payoutAccounts(affiliateId) };
}

export function setDefaultPayoutAccount(affiliateId: string, id: string) {
  db.prepare(
    `UPDATE affiliate_payout_accounts SET is_default = 0 WHERE affiliate_id = ?`,
  ).run(affiliateId);
  db.prepare(
    `UPDATE affiliate_payout_accounts SET is_default = 1 WHERE id = ? AND affiliate_id = ?`,
  ).run(id, affiliateId);
  return { ok: true as const, accounts: payoutAccounts(affiliateId) };
}

// ── payouts (request only — an operator sends the money) ────────────────────

const shapePayout = (r: any): PayoutRow => ({
  id: str(r.id),
  amount: num(r.amount),
  method: str(r.method, "upi"),
  destination: str(r.destination),
  status: str(r.status, "requested") as PayoutRow["status"],
  note: str(r.note),
  utr: str(r.utr),
  requestedAt: num(r.requested_at),
  decidedAt: r.decided_at ? num(r.decided_at) : null,
});

export function payoutsFor(affiliateId: string, limit = 60): PayoutRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM affiliate_payouts WHERE affiliate_id = ?
        ORDER BY requested_at DESC LIMIT ?`,
    )
    .all(affiliateId, limit) as any[];
  return rows.map(shapePayout);
}

function destinationText(a: PayoutAccount) {
  if (a.kind === "upi") return `UPI · ${a.upiId}`;
  if (a.kind === "bank")
    return `Bank · ****${a.accountTail}${a.bankName ? ` · ${a.bankName}` : ""}`;
  return `USDT · ${a.usdtNetwork || "TRC20"} · ${a.usdtAddress.slice(0, 6)}…${a.usdtAddress.slice(-4)}`;
}

export function requestPayout(input: {
  affiliateId: string;
  amount: number;
  accountId?: string;
  note?: string;
}) {
  const aff = affiliateById(String(input.affiliateId));
  if (!aff)
    return { ok: false as const, error: "Affiliate not found", status: 404 };
  if (aff.status !== "approved")
    return {
      ok: false as const,
      error: "Your account is not active",
      status: 403,
    };

  const accounts = payoutAccounts(aff.id);
  if (!accounts.length)
    return {
      ok: false as const,
      error:
        "Add a payout destination first — we cannot send money without one",
      status: 400,
    };
  const account =
    accounts.find((a) => a.id === String(input.accountId || "")) ||
    accounts.find((a) => a.isDefault) ||
    accounts[0];

  const available = availableTotal(aff.id);
  const amount = Math.round(num(input.amount) * 100) / 100;
  if (!(amount > 0))
    return {
      ok: false as const,
      error: "Enter an amount above zero",
      status: 400,
    };
  if (amount > available)
    return {
      ok: false as const,
      error: `You can request up to ₹${available.toLocaleString("en-IN")} right now`,
      status: 400,
    };
  if (amount < aff.minPayout)
    return {
      ok: false as const,
      error: `Minimum payout is ₹${aff.minPayout.toLocaleString("en-IN")}`,
      status: 400,
    };

  // One open request at a time. Two pending requests for the same balance would
  // both pass the check above and let a partner be paid twice.
  const open = db
    .prepare(
      `SELECT id FROM affiliate_payouts
        WHERE affiliate_id = ? AND status IN ('requested','approved') LIMIT 1`,
    )
    .get(aff.id) as { id?: string } | undefined;
  if (open)
    return {
      ok: false as const,
      error: "You already have a payout request being processed",
      status: 409,
    };

  const id = `PO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  try {
    db.prepare(
      `INSERT INTO affiliate_payouts
         (id, affiliate_id, amount, method, account_id, destination, status, note,
          requested_at, updated_at)
       VALUES (?,?,?,?,?,?, 'requested', ?,?,?)`,
    ).run(
      id,
      aff.id,
      amount,
      account.kind,
      account.id,
      destinationText(account),
      String(input.note || "").slice(0, 300),
      Date.now(),
      Date.now(),
    );
  } catch (e: any) {
    // The partial unique index `ux_aff_payout_open` enforces the rule the check
    // above tests for. The check is not atomic, so this is the case where two
    // requests raced and the other one won — which is a duplicate request, not a
    // server fault, and must not read as one.
    if (String(e?.code || "").includes("CONSTRAINT"))
      return {
        ok: false as const,
        error: "You already have a payout request being processed",
        status: 409,
      };
    throw e;
  }
  return { ok: true as const, id, payout: payoutsFor(aff.id)[0] };
}

// ── statistics ──────────────────────────────────────────────────────────────

export type Series = {
  date: string;
  clicks: number;
  signups: number;
  earned: number;
};

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Daily clicks / signups / earnings for the last `days` days, zeros filled. */
export function series(affiliateId: string, days = 30): Series[] {
  const from = Date.now() - days * 86400_000;
  const aff = affiliateById(affiliateId);
  if (!aff) return [];
  const clicks = db
    .prepare(`SELECT ts FROM affiliate_clicks WHERE code = ? AND ts >= ?`)
    .all(aff.code, from) as { ts: number }[];
  const signups = db
    .prepare(
      `SELECT created_at FROM affiliate_referrals WHERE affiliate_id = ? AND created_at >= ?`,
    )
    .all(affiliateId, from) as { created_at: number }[];
  const earned = db
    .prepare(
      `SELECT created_at, amount FROM affiliate_commissions
        WHERE affiliate_id = ? AND created_at >= ? AND status <> 'reversed'`,
    )
    .all(affiliateId, from) as { created_at: number; amount: number }[];

  const buckets = new Map<string, Series>();
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400_000);
    buckets.set(k, { date: k, clicks: 0, signups: 0, earned: 0 });
  }
  const bump = (k: string, field: keyof Omit<Series, "date">, by = 1) => {
    const b = buckets.get(k);
    if (b) b[field] = Math.round((b[field] + by) * 100) / 100;
  };
  for (const c of clicks) bump(dayKey(num(c.ts)), "clicks");
  for (const s of signups) bump(dayKey(num(s.created_at)), "signups");
  for (const e of earned)
    bump(dayKey(num(e.created_at)), "earned", num(e.amount));
  return [...buckets.values()];
}

export type Summary = {
  clicks: number;
  signups: number;
  conversion: number;
  customers: number;
  deposited: number;
  earned: number;
  pending: number;
  available: number;
  paid: number;
  reversed: number;
};

export function summary(affiliateId: string): Summary {
  const aff = affiliateById(affiliateId);
  const clicks = aff
    ? num(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM affiliate_clicks WHERE code = ?`,
            )
            .get(aff.code) as { n?: number } | undefined
        )?.n,
      )
    : 0;
  const refs = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(deposited),0) AS d
         FROM affiliate_referrals WHERE affiliate_id = ?`,
    )
    .get(affiliateId) as { n?: number; d?: number } | undefined;
  const signups = num(refs?.n);
  const earned = earnedTotal(affiliateId);
  return {
    clicks,
    signups,
    conversion: clicks > 0 ? Math.round((signups / clicks) * 1000) / 10 : 0,
    customers: signups,
    deposited: num(refs?.d),
    earned,
    pending: pendingTotal(affiliateId),
    available: availableTotal(affiliateId),
    paid: paidTotal(affiliateId),
    reversed: reversedTotal(affiliateId),
  };
}

/** Everything the dashboard needs in one round trip. */
export function dashboard(affiliateId: string, days = 30) {
  const aff = affiliateById(affiliateId);
  if (!aff) return null;
  return {
    affiliate: publicProfile(aff),
    summary: summary(affiliateId),
    series: series(affiliateId, days),
    recentReferrals: referralsFor(affiliateId, 8),
    recentCommissions: commissionsFor(affiliateId, 8),
    // Surfaced on the dashboard because it is the answer to the first question a
    // partner asks when "available" reads ₹0: where did my money go?
    openPayout:
      payoutsFor(affiliateId, 20).find(
        (p) => p.status === "requested" || p.status === "approved",
      ) || null,
  };
}

/** What a partner is allowed to see about their own account. */
export function publicProfile(aff: Affiliate) {
  return {
    id: aff.id,
    code: aff.code,
    name: aff.name,
    email: aff.email,
    phone: aff.phone,
    company: aff.company,
    website: aff.website,
    audience: aff.audience,
    status: aff.status,
    planId: aff.planId,
    planName: aff.planName,
    model: aff.model,
    modelLabel: modelLabel(aff.model),
    depositRate: aff.depositRate,
    revRate: aff.revRate,
    holdDays: aff.holdDays,
    minPayout: aff.minPayout,
    createdAt: aff.createdAt,
    rejectReason: aff.rejectReason,
  };
}

// ── operator side ───────────────────────────────────────────────────────────
//
// Everything the admin console needs. Read-only helpers are grouped here so the
// console never has to reach into the affiliate tables itself — if the schema
// changes, this file is the only thing that has to know.
//
// The aggregates are computed with a handful of GROUP BY queries rather than a
// per-affiliate loop. With a dozen partners the difference is invisible; with a
// thousand it is the difference between a page and a timeout.

/** Clicks, signups and deposits grouped by campaign tag. */
export function campaignBreakdown(affiliateId: string) {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(campaign,''), '(none)') AS campaign,
              COUNT(*) AS signups,
              COALESCE(SUM(deposited), 0) AS deposited
         FROM affiliate_referrals WHERE affiliate_id = ?
        GROUP BY campaign ORDER BY deposited DESC`,
    )
    .all(affiliateId) as any[];
  return rows.map((r) => ({
    campaign: str(r.campaign),
    signups: num(r.signups),
    deposited: num(r.deposited),
  }));
}

export type AdminAffiliateRow = Affiliate & {
  customers: number;
  deposited: number;
  earned: number;
  pending: number;
  available: number;
  paid: number;
  clicks: number;
  awaitingPayouts: number;
  lastActivity: number | null;
};

/**
 * The partner directory, with the numbers an operator actually judges on.
 *
 * `available` is derived the same way the partner's own panel derives it
 * (released minus everything committed to a payout), so the console and the
 * partner can never disagree about what is owed — which is the single most
 * common source of a payout argument.
 */
export function listAffiliatesAdmin(
  status?: string,
  q?: string,
): AdminAffiliateRow[] {
  const rows = listAffiliates(status);
  const needle = String(q || "")
    .trim()
    .toLowerCase();
  const filtered = needle
    ? rows.filter(
        (a) =>
          a.name.toLowerCase().includes(needle) ||
          a.email.toLowerCase().includes(needle) ||
          a.code.toLowerCase().includes(needle) ||
          a.company.toLowerCase().includes(needle),
      )
    : rows;
  if (!filtered.length) return [];

  const ids = filtered.map((a) => a.id);
  const marks = ids.map(() => "?").join(",");

  const refMap = new Map<string, { n: number; d: number }>();
  for (const r of db
    .prepare(
      `SELECT affiliate_id, COUNT(*) AS n, COALESCE(SUM(deposited),0) AS d
         FROM affiliate_referrals WHERE affiliate_id IN (${marks})
        GROUP BY affiliate_id`,
    )
    .all(...ids) as any[])
    refMap.set(str(r.affiliate_id), { n: num(r.n), d: num(r.d) });

  const commMap = new Map<string, Record<string, number>>();
  for (const r of db
    .prepare(
      `SELECT affiliate_id, status, COALESCE(SUM(amount),0) AS t
         FROM affiliate_commissions WHERE affiliate_id IN (${marks})
        GROUP BY affiliate_id, status`,
    )
    .all(...ids) as any[]) {
    const key = str(r.affiliate_id);
    const cur = commMap.get(key) || {};
    cur[str(r.status)] = num(r.t);
    commMap.set(key, cur);
  }

  const payMap = new Map<string, Record<string, number>>();
  for (const r of db
    .prepare(
      `SELECT affiliate_id, status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS t
         FROM affiliate_payouts WHERE affiliate_id IN (${marks})
        GROUP BY affiliate_id, status`,
    )
    .all(...ids) as any[]) {
    const key = str(r.affiliate_id);
    const cur = payMap.get(key) || {};
    cur[`${str(r.status)}Amount`] = num(r.t);
    cur[`${str(r.status)}Count`] = num(r.n);
    payMap.set(key, cur);
  }

  const clickMap = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT code, COUNT(*) AS n FROM affiliate_clicks WHERE code IN (${marks})
        GROUP BY code`,
    )
    .all(...filtered.map((a) => a.code)) as any[])
    clickMap.set(str(r.code), num(r.n));

  const actMap = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT affiliate_id, MAX(ts) AS t FROM (
         SELECT affiliate_id, created_at AS ts FROM affiliate_referrals WHERE affiliate_id IN (${marks})
         UNION ALL
         SELECT affiliate_id, created_at AS ts FROM affiliate_commissions WHERE affiliate_id IN (${marks})
         UNION ALL
         SELECT affiliate_id, requested_at AS ts FROM affiliate_payouts WHERE affiliate_id IN (${marks})
       ) GROUP BY affiliate_id`,
    )
    .all(...ids, ...ids, ...ids) as any[])
    actMap.set(str(r.affiliate_id), num(r.t));

  return filtered.map((a) => {
    // Holdbacks are released lazily on read, so refresh before reporting a
    // balance. Without this the console shows money as "in holdback" for days
    // after the partner's own panel has already moved it to "available".
    releaseDue(a.id);
    const ref = refMap.get(a.id) || { n: 0, d: 0 };
    const c = commMap.get(a.id) || {};
    const p = payMap.get(a.id) || {};
    const pending = num(c.pending);
    const approved = num(c.approved);
    const committed =
      num(p.requestedAmount) + num(p.approvedAmount) + num(p.paidAmount);
    return {
      ...a,
      customers: ref.n,
      deposited: ref.d,
      earned: Math.round((pending + approved + num(c.paid)) * 100) / 100,
      pending,
      available: Math.max(0, Math.round((approved - committed) * 100) / 100),
      paid: num(p.paidAmount),
      clicks: clickMap.get(a.code) || 0,
      awaitingPayouts: num(p.requestedCount) + num(p.approvedCount),
      lastActivity: actMap.get(a.id) || null,
    };
  });
}

/** Platform-wide figures for the section header. */
export function adminOverview() {
  const one = (sql: string, ...args: any[]) => {
    const r = db.prepare(sql).get(...args) as any;
    return num(r?.t);
  };
  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM affiliates GROUP BY status`)
    .all() as any[];
  const byStatus = new Map(counts.map((r) => [str(r.status), num(r.n)]));
  const total = [...byStatus.values()].reduce((n, v) => n + v, 0);

  const clicks = one(`SELECT COUNT(*) AS t FROM affiliate_clicks`);
  const signups = one(`SELECT COUNT(*) AS t FROM affiliate_referrals`);
  const deposited = one(
    `SELECT COALESCE(SUM(deposited),0) AS t FROM affiliate_referrals`,
  );
  const earned = one(
    `SELECT COALESCE(SUM(amount),0) AS t FROM affiliate_commissions WHERE status <> 'reversed'`,
  );
  const committed = one(
    `SELECT COALESCE(SUM(amount),0) AS t FROM affiliate_payouts
      WHERE status IN ('requested','approved','paid')`,
  );
  const paid = one(
    `SELECT COALESCE(SUM(amount),0) AS t FROM affiliate_payouts WHERE status = 'paid'`,
  );
  const awaiting = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM affiliate_payouts
        WHERE status IN ('requested','approved')`,
    )
    .get() as any;
  const held = one(
    `SELECT COALESCE(SUM(amount),0) AS t FROM affiliate_commissions WHERE status = 'pending'`,
  );

  return {
    affiliates: {
      total,
      pending: byStatus.get("pending") || 0,
      approved: byStatus.get("approved") || 0,
      suspended: byStatus.get("suspended") || 0,
      rejected: byStatus.get("rejected") || 0,
    },
    traffic: {
      clicks,
      signups,
      conversion: clicks > 0 ? Math.round((signups / clicks) * 1000) / 10 : 0,
    },
    money: {
      deposited,
      earned,
      inHoldback: held,
      // What the platform still owes, and what it has already sent. `committed`
      // includes paid on purpose: money that has gone out is not available again.
      committed,
      owed: Math.max(0, Math.round((earned - committed) * 100) / 100),
      paid,
      awaitingCount: num(awaiting?.n),
      awaitingAmount: num(awaiting?.t),
    },
  };
}

export type AdminPayoutRow = PayoutRow & {
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  affiliateCode: string;
  affiliateStatus: string;
  /** What this partner could request right now, for a sense of scale. */
  affiliateAvailable: number;
  accountKind: string;
};

/** The payout queue: everything requested, then what has been decided. */
export function payoutQueue(status?: string, limit = 200): AdminPayoutRow[] {
  const where = status && status !== "all" ? `WHERE p.status = ?` : "";
  const rows = db
    .prepare(
      `SELECT p.*, a.name AS aff_name, a.email AS aff_email, a.code AS aff_code,
              a.status AS aff_status
         FROM affiliate_payouts p
         LEFT JOIN affiliates a ON a.id = p.affiliate_id
         ${where}
        ORDER BY CASE p.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                 p.requested_at DESC
        LIMIT ?`,
    )
    .all(...(where ? [String(status), limit] : [limit])) as any[];

  const available = new Map<string, number>();
  for (const id of new Set(rows.map((r) => str(r.affiliate_id)))) {
    const aff = affiliateById(id);
    if (aff) available.set(id, availableTotal(aff.id));
  }

  return rows.map((r) => {
    const id = str(r.affiliate_id);
    return {
      id: str(r.id),
      amount: num(r.amount),
      method: str(r.method, "upi"),
      destination: str(r.destination),
      status: str(r.status, "requested") as PayoutRow["status"],
      note: str(r.note),
      utr: str(r.utr),
      requestedAt: num(r.requested_at),
      decidedAt: r.decided_at ? num(r.decided_at) : null,
      affiliateId: id,
      affiliateName: str(r.aff_name, "(deleted affiliate)"),
      affiliateEmail: str(r.aff_email),
      affiliateCode: str(r.aff_code),
      affiliateStatus: str(r.aff_status),
      affiliateAvailable: available.get(id) || 0,
      accountKind: str(r.method, "upi"),
    };
  });
}

/**
 * Decide a payout request.
 *
 * The transition rules are enforced here rather than in the route, because this
 * function moves real money and there must be exactly one place that decides
 * what is legal:
 *
 *   requested ─┬─> approved ─┬─> paid      (terminal)
 *              │             └─> rejected  (terminal)
 *              ├─> paid      (paid in one step, short-circuiting "approved")
 *              └─> rejected
 *
 * `paid` and `rejected` are TERMINAL. A payout that has been marked paid can
 * never be re-marked: the money has left, and a second edit would rewrite the
 * record of a transfer that already happened. Correcting a mistake means a new
 * payout, not a quieter history.
 */
export function decidePayout(input: {
  id: string;
  status: "approved" | "paid" | "rejected";
  utr?: string;
  note?: string;
  actor?: string | null;
}) {
  const id = String(input.id || "");
  const row = db
    .prepare(`SELECT * FROM affiliate_payouts WHERE id = ?`)
    .get(id) as any;
  if (!row)
    return { ok: false as const, error: "Payout not found", status: 404 };

  const from = str(row.status, "requested");
  const to = input.status;
  if (!["approved", "paid", "rejected"].includes(to))
    return { ok: false as const, error: "Unknown status", status: 400 };

  if (from === "paid")
    return {
      ok: false as const,
      error:
        "This payout is already marked paid. Money has left the account, so the record cannot be edited — send a correcting payout instead.",
      status: 409,
    };
  if (from === "rejected")
    return {
      ok: false as const,
      error:
        "This payout was already rejected. The partner must submit a new request.",
      status: 409,
    };
  if (from === "approved" && to === "approved")
    return { ok: false as const, error: "Already approved", status: 409 };

  // A rejection is read by the partner, so it must say something. An empty
  // refusal is worse than no decision: it tells them nothing and looks careless.
  const note = String(input.note || "").trim();
  if (to === "rejected" && !note)
    return {
      ok: false as const,
      error:
        'Add a reason — the partner sees this, and "rejected" alone is not an answer',
      status: 400,
    };

  const utr = String(input.utr || "")
    .trim()
    .slice(0, 80);
  db.prepare(
    `UPDATE affiliate_payouts
        SET status = ?, note = ?, utr = ?, decided_at = ?, decided_by = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    to,
    to === "rejected"
      ? note.slice(0, 300)
      : to === "paid"
        ? ""
        : note.slice(0, 300),
    to === "paid" ? utr : "",
    Date.now(),
    input.actor ? String(input.actor).slice(0, 128) : null,
    Date.now(),
    id,
  );

  const fresh = db
    .prepare(`SELECT * FROM affiliate_payouts WHERE id = ?`)
    .get(id) as any;
  return {
    ok: true as const,
    payout: {
      id: str(fresh.id),
      amount: num(fresh.amount),
      method: str(fresh.method),
      destination: str(fresh.destination),
      status: str(fresh.status) as PayoutRow["status"],
      note: str(fresh.note),
      utr: str(fresh.utr),
      requestedAt: num(fresh.requested_at),
      decidedAt: fresh.decided_at ? num(fresh.decided_at) : null,
    },
  };
}

/** One affiliate, everything about them, for the console drawer. */
export function affiliateAdminDetail(id: string) {
  const aff = affiliateById(id);
  if (!aff) return null;
  return {
    affiliate: {
      ...publicProfile(aff),
      note: aff.note,
      decidedAt: aff.decidedAt,
      lastLogin: aff.lastLogin,
      loginCount: aff.loginCount,
    },
    summary: summary(aff.id),
    series: series(aff.id, 90),
    referrals: referralsFor(aff.id, 200),
    commissions: commissionsFor(aff.id, 200),
    payouts: payoutsFor(aff.id, 100),
    accounts: payoutAccounts(aff.id),
    campaigns: campaignBreakdown(aff.id),
  };
}

// ── landing pages ───────────────────────────────────────────────────────────

export type LandingPage = {
  slug: string;
  title: string;
  headline: string;
  subheadline: string;
  offer: string;
  cta: string;
  tags: string;
  /** Short selling points for this page, rendered as a ticked strip. */
  highlights: string[];
};

/**
 * Parse the stored highlights. Never throws: a malformed value in the database
 * must not take a live landing page down, it should just render without the
 * strip. Capped at 6 — more than that stops being a summary.
 */
function parseHighlights(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

const shapePage = (r: any): LandingPage => ({
  slug: str(r.slug),
  title: str(r.title),
  headline: str(r.headline),
  subheadline: str(r.subheadline),
  offer: str(r.offer),
  cta: str(r.cta, "Open free account"),
  tags: str(r.tags),
  highlights: parseHighlights(r.highlights),
});

export function landingPages(onlyPublished = true): LandingPage[] {
  const rows = db
    .prepare(
      `SELECT slug, title, headline, subheadline, offer, cta, tags, highlights
         FROM landing_pages ${onlyPublished ? "WHERE published = 1" : ""}
        ORDER BY created_at ASC`,
    )
    .all() as any[];
  return rows.map(shapePage);
}

export function landingPage(slug: string): LandingPage | null {
  const r = db
    .prepare(
      `SELECT slug, title, headline, subheadline, offer, cta, tags, highlights
         FROM landing_pages WHERE slug = ? AND published = 1`,
    )
    .get(String(slug)) as any;
  return r ? shapePage(r) : null;
}
