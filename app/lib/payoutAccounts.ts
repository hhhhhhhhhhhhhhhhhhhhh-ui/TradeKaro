import { db } from "./db";

// ── Payout accounts ─────────────────────────────────────────────────────────
//
// Where a customer wants money sent. UPI or bank transfer, one list per user.
//
// Server-side on purpose. The old list lived in `localStorage` (`fs_bank_accounts`),
// which was fine while nothing could send money — but a payout has to go to an
// account the SERVER holds, because a beneficiary supplied by the browser at
// withdrawal time is precisely the field an attacker would want to control. The
// device list is imported once, per user, and then this table is the truth.

export type PayoutAccountKind = "upi" | "bank";

export type PayoutAccount = {
  id: string;
  user_id: string;
  kind: PayoutAccountKind;
  label: string | null;
  holder_name: string | null;
  upi_id: string | null;
  account_number: string | null;
  ifsc: string | null;
  bank_name: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
};

export type PayoutAccountInput = {
  kind: string;
  label?: string | null;
  holderName?: string | null;
  upiId?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
};

export type AccountResult =
  | { ok: true; account: PayoutAccount }
  | { ok: false; error: string; status: number };

/** A UPI VPA looks like `name@bank`. Deliberately loose — banks vary. */
const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/;
/** Indian bank account numbers are 9–18 digits. */
const ACCOUNT_RE = /^\d{9,18}$/;
/** IFSC: four letters, a zero, then six alphanumerics. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function newId(prefix = "PA"): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

export function accountsFor(userId: string): PayoutAccount[] {
  return db
    .prepare(
      `SELECT * FROM payout_accounts WHERE user_id = ?
        ORDER BY is_default DESC, created_at DESC`,
    )
    .all(userId) as PayoutAccount[];
}

export function accountById(
  userId: string,
  id: string,
): PayoutAccount | undefined {
  return db
    .prepare("SELECT * FROM payout_accounts WHERE user_id = ? AND id = ?")
    .get(userId, id) as PayoutAccount | undefined;
}

/**
 * How an account is described to an operator who is about to send money to it.
 * The middle of the account number is masked — enough to recognise, not enough
 * to be worth copying out of a screenshot.
 */
export function describeAccount(a: PayoutAccount): string {
  if (a.kind === "upi") return `UPI ${a.upi_id || "—"}`;
  const n = String(a.account_number || "");
  const masked =
    n.length > 4 ? `${"•".repeat(Math.min(6, n.length - 4))}${n.slice(-4)}` : n;
  return `Bank ${masked}${a.ifsc ? ` · ${a.ifsc}` : ""}${a.bank_name ? ` · ${a.bank_name}` : ""}`;
}

export function addAccount(
  userId: string,
  input: PayoutAccountInput,
): AccountResult {
  const kind =
    input.kind === "bank" ? "bank" : input.kind === "upi" ? "upi" : null;
  if (!kind)
    return { ok: false, error: "Choose UPI or bank transfer", status: 400 };

  const holderName = String(input.holderName || "")
    .trim()
    .slice(0, 80);
  const label =
    String(input.label || "")
      .trim()
      .slice(0, 40) || null;

  if (kind === "upi") {
    const upiId = String(input.upiId || "")
      .trim()
      .slice(0, 120);
    if (!UPI_RE.test(upiId))
      return {
        ok: false,
        // Naming the shape is the difference between "invalid" and a fix.
        error: "Enter a UPI ID like name@bank",
        status: 400,
      };
    const dupe = db
      .prepare(
        "SELECT id FROM payout_accounts WHERE user_id = ? AND kind = 'upi' AND lower(upi_id) = lower(?)",
      )
      .get(userId, upiId) as { id: string } | undefined;
    if (dupe)
      return { ok: false, error: "That UPI ID is already saved", status: 400 };
    return insert(userId, {
      kind,
      label,
      holderName,
      upiId,
      accountNumber: null,
      ifsc: null,
      bankName: null,
    });
  }

  const accountNumber = String(input.accountNumber || "").replace(/\s+/g, "");
  const ifsc = String(input.ifsc || "")
    .trim()
    .toUpperCase();
  const bankName =
    String(input.bankName || "")
      .trim()
      .slice(0, 80) || null;
  if (!ACCOUNT_RE.test(accountNumber))
    return {
      ok: false,
      error: "Account number must be 9 to 18 digits",
      status: 400,
    };
  if (!IFSC_RE.test(ifsc))
    return {
      ok: false,
      error: "Enter a valid IFSC, like HDFC0001234",
      status: 400,
    };
  const dupe = db
    .prepare(
      "SELECT id FROM payout_accounts WHERE user_id = ? AND kind = 'bank' AND account_number = ?",
    )
    .get(userId, accountNumber) as { id: string } | undefined;
  if (dupe)
    return { ok: false, error: "That account is already saved", status: 400 };

  return insert(userId, {
    kind,
    label,
    holderName,
    upiId: null,
    accountNumber,
    ifsc,
    bankName,
  });
}

function insert(
  userId: string,
  v: {
    kind: PayoutAccountKind;
    label: string | null;
    holderName: string;
    upiId: string | null;
    accountNumber: string | null;
    ifsc: string | null;
    bankName: string | null;
  },
): AccountResult {
  const now = Date.now();
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM payout_accounts WHERE user_id = ?")
    .get(userId) as { n: number };
  // The first account is the default — a customer with one account should never
  // have to nominate it.
  const isDefault = Number(count?.n) === 0 ? 1 : 0;
  const id = newId();
  db.prepare(
    `INSERT INTO payout_accounts
       (id, user_id, kind, label, holder_name, upi_id, account_number, ifsc,
        bank_name, is_default, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    v.kind,
    v.label,
    v.holderName || null,
    v.upiId,
    v.accountNumber,
    v.ifsc,
    v.bankName,
    isDefault,
    now,
    now,
  );
  return { ok: true, account: accountById(userId, id)! };
}

export function removeAccount(userId: string, id: string): boolean {
  const r = db
    .prepare("DELETE FROM payout_accounts WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return Number(r.changes) > 0;
}

/** True when this account is named on a withdrawal that is not closed. */
export function accountInUse(id: string): boolean {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM withdrawals
        WHERE account_id = ? AND status IN ('requested','approved','processing')`,
    )
    .get(id) as { n: number };
  return Number(r?.n) > 0;
}

export function setDefaultAccount(userId: string, id: string): boolean {
  const acct = accountById(userId, id);
  if (!acct) return false;
  db.prepare("UPDATE payout_accounts SET is_default = 0 WHERE user_id = ?").run(
    userId,
  );
  db.prepare(
    "UPDATE payout_accounts SET is_default = 1, updated_at = ? WHERE id = ?",
  ).run(Date.now(), id);
  return true;
}

/**
 * Import the device-only list once.
 *
 * The old accounts live in the customer's browser and are about to stop being
 * used, so dropping them silently would look like the app lost their bank
 * details. Anything we cannot re-validate is skipped and counted rather than
 * stored hopefully — the validation above is the same gate a new account passes.
 *
 * ⚠️ Field names: the old device records used `holder` and `accountNo`, not
 * `holderName` and `accountNumber`. Reading only the new spelling meant a
 * legacy BANK account arrived with a null account number, failed validation,
 * was reported as skipped, and was then cleared from the device by the caller
 * anyway — so the customer's saved bank account disappeared permanently on the
 * first visit. UPI escaped this because it always used `vpa`. Both spellings
 * are accepted now.
 */
export function importDeviceAccounts(
  userId: string,
  list: unknown,
): { imported: number; skipped: number } {
  if (!Array.isArray(list)) return { imported: 0, skipped: 0 };
  const existing = accountsFor(userId);
  if (existing.length) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;
  for (const raw of list.slice(0, 10)) {
    const a = (raw || {}) as any;
    const looksUpi = a?.upiId || a?.vpa || a?.upi;
    const res = addAccount(userId, {
      kind: looksUpi ? "upi" : "bank",
      label: a?.label || a?.nickname || null,
      holderName: a?.holderName || a?.holder || a?.name || null,
      upiId: looksUpi,
      accountNumber: a?.accountNumber || a?.accountNo || a?.account || null,
      ifsc: a?.ifsc || null,
      bankName: a?.bankName || a?.bank || null,
    });
    if (res.ok) imported += 1;
    else skipped += 1;
  }
  return { imported, skipped };
}
