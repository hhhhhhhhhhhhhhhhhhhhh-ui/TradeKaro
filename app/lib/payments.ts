import crypto from "crypto";
import { db } from "./db";
import { runtimeSettings } from "./adminRuntime";
import { recordDeposit } from "./deposits";
import { accountById as payoutAccountById } from "./payoutAccounts";
import {
  attachPayout,
  markApproved,
  markProcessing,
  markRejected,
  reopen,
  syncFromPayout,
  withdrawalById,
} from "./withdrawals";
import {
  createPayin,
  createPayout,
  isFinalStatus,
  merchantBalance,
  money2,
  railConfigured,
  sunpayConfig,
  verifySignature,
  webhookSecretFor,
  type PayinCreated,
  type SunpayConfig,
} from "./sunpay";

// ── Payment gateway: orders, callbacks and the ledger hand-off ───────────────
//
// The rule this file exists to enforce: a deposit is credited ONLY by a
// server-verified callback for an order WE created, at an amount WE set. Nothing
// the browser sends ever becomes money, and nothing in the callback's body is
// trusted for the amount — the callback says "this order succeeded", the amount
// comes from our own row.
//
// The gateway delivers at-least-once with up to 200 retries, so a duplicate
// callback is the expected case. Idempotency is enforced twice, at two
// different layers, on purpose:
//
//   1. `payment_webhooks` has a unique index on (txn_id, status). The INSERT is
//      the dedupe — two concurrent identical deliveries cannot both succeed, and
//      a second one loses the race at the database rather than in an `if`.
//   2. `recordDeposit` takes an `idem` key derived from the same txn id, so even
//      if the row above were somehow lost, the ledger still refuses to credit
//      twice.
//
// Either layer alone would be enough on a quiet day. Both is what makes it safe
// on a bad one.

export type PaymentOrder = {
  order_id: string;
  user_id: string;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  txn_id: string | null;
  checkout_url: string | null;
  utr: string | null;
  created_at: number;
  updated_at: number;
};

export type PayoutRow = {
  payout_id: string;
  user_id: string;
  amount: number;
  fee: number | null;
  net_amount: number | null;
  currency: string;
  method: string;
  beneficiary_name: string | null;
  beneficiary_account: string | null;
  ifsc: string | null;
  bank_name: string | null;
  status: string;
  utr: string | null;
  actor: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};

/**
 * Our own order id.
 *
 * Unique, and readable enough to trace through the gateway's dashboard. The
 * gateway treats it as an idempotency key, so it must never be reused for a
 * different payment.
 */
export function newOrderId(prefix = "TK"): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${t}-${r}`;
}

export async function paymentsStatus() {
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);
  return {
    enabled: cfg.enabled,
    payoutsEnabled: cfg.payoutsEnabled,
    payinReady: railConfigured(cfg, "payin"),
    payoutReady: railConfigured(cfg, "payout"),
    minAmount: cfg.minAmount,
    maxAmount: cfg.maxAmount,
    baseUrl: cfg.baseUrl,
    // Deliberately vague, and never the key itself.
    payinKeyHint: cfg.payinApiKey ? `••••${cfg.payinApiKey.slice(-4)}` : "",
    payoutKeyHint: cfg.payoutApiKey ? `••••${cfg.payoutApiKey.slice(-4)}` : "",
  };
}

export function payinOrdersFor(userId: string, limit = 50): PaymentOrder[] {
  return db
    .prepare(
      `SELECT order_id, user_id, amount, currency, method, status, txn_id,
              checkout_url, utr, created_at, updated_at
         FROM payment_orders WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as PaymentOrder[];
}

export function payinOrder(orderId: string): PaymentOrder | undefined {
  return db
    .prepare(
      `SELECT order_id, user_id, amount, currency, method, status, txn_id,
              checkout_url, utr, created_at, updated_at
         FROM payment_orders WHERE order_id = ?`,
    )
    .get(orderId) as PaymentOrder | undefined;
}

export function payoutsFor(userId: string, limit = 50): PayoutRow[] {
  return db
    .prepare(
      `SELECT * FROM payment_payouts WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as PayoutRow[];
}

export type CreatePayinOutcome =
  | { ok: true; order: PaymentOrder; checkoutUrl: string }
  | { ok: false; error: string; status: number };

/**
 * Create a pay-in order and return the hosted checkout URL.
 *
 * The row is written BEFORE the gateway is called, so a callback that arrives
 * while we are still waiting on the HTTP response still finds an order to match.
 * On gateway failure the row is marked failed rather than deleted — an operator
 * asking "did we ever ask for this order?" should get an answer.
 */
export async function startPayin(input: {
  userId: string;
  amount: number;
  method?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notifyUrl?: string;
}): Promise<CreatePayinOutcome> {
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);

  if (!cfg.enabled)
    return {
      ok: false,
      error: "Online payments are switched off",
      status: 503,
    };
  if (!railConfigured(cfg, "payin"))
    return {
      ok: false,
      error: "Payment gateway is not configured",
      status: 503,
    };

  const amount = money2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Enter an amount above zero", status: 400 };
  if (amount < cfg.minAmount)
    return {
      ok: false,
      error: `Minimum online top-up is ₹${cfg.minAmount.toLocaleString("en-IN")}`,
      status: 400,
    };
  if (amount > cfg.maxAmount)
    return {
      ok: false,
      error: `Maximum online top-up is ₹${cfg.maxAmount.toLocaleString("en-IN")}`,
      status: 400,
    };

  const orderId = newOrderId("TK");
  const now = Date.now();
  db.prepare(
    `INSERT INTO payment_orders
       (order_id, user_id, amount, currency, method, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    orderId,
    input.userId,
    amount,
    "INR",
    input.method || "upi",
    "new",
    now,
    now,
  );

  const res = await createPayin(cfg, {
    orderId,
    amount,
    method: input.method || "upi",
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    notifyUrl: input.notifyUrl,
    metadata: { user: input.userId },
  });

  if (!res.ok) {
    db.prepare(
      "UPDATE payment_orders SET status = ?, raw = ?, updated_at = ? WHERE order_id = ?",
    ).run("failed", JSON.stringify({ error: res.error }), Date.now(), orderId);
    return { ok: false, error: res.error, status: res.status };
  }

  const d: PayinCreated = res.data;
  const url = d.checkout_url || d.payment_url || d.redirect_url || "";
  db.prepare(
    `UPDATE payment_orders
        SET status = ?, txn_id = ?, checkout_url = ?, raw = ?, updated_at = ?
      WHERE order_id = ?`,
  ).run(
    d.status || "pending",
    d.id || null,
    url || null,
    JSON.stringify(d).slice(0, 4000),
    Date.now(),
    orderId,
  );

  if (!url) {
    // A successful call with no checkout URL is not a usable order. Say so
    // instead of redirecting the customer to an empty string.
    return {
      ok: false,
      error: "Gateway did not return a checkout URL",
      status: 502,
    };
  }

  return { ok: true, order: payinOrder(orderId)!, checkoutUrl: url };
}

export type WebhookOutcome = {
  status: number;
  outcome: string;
  note?: string;
  credited?: number;
};

/** Insert the delivery record. Returns false when this exact state was seen. */
function logWebhook(row: {
  event: string;
  txnId: string | null;
  refId: string | null;
  status: string | null;
  signatureOk: boolean;
  outcome: string;
  raw: string;
}): boolean {
  try {
    db.prepare(
      `INSERT INTO payment_webhooks
         (ts, event, txn_id, ref_id, status, signature_ok, outcome, raw)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      Date.now(),
      row.event.slice(0, 64),
      row.txnId,
      row.refId,
      row.status,
      row.signatureOk ? 1 : 0,
      row.outcome,
      row.raw.slice(0, 4000),
    );
    return true;
  } catch (e: any) {
    // The unique index on (txn_id, status) is the idempotency guard; losing the
    // race for it IS the duplicate signal.
    if (/UNIQUE|constraint/i.test(String(e?.message || e))) return false;
    throw e;
  }
}

/**
 * Apply a pay-in callback.
 *
 * `rawBody` must be the untouched request body — the signature is over those
 * exact bytes, so a re-serialised object can never verify.
 */
export async function applyPayinWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookOutcome> {
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);
  if (!railConfigured(cfg, "payin"))
    return { status: 503, outcome: "not_configured" };

  // ⚠️ The callback is signed with the provider's WEBHOOK secret, not the
  // pay-in API secret. `webhookSecretFor` falls back to the API secret when the
  // webhook secret is unset, so an account issued one value for both still
  // works — but getting this wrong rejects every callback with a bad signature,
  // which looks exactly like "callbacks are not arriving".
  if (!verifySignature(rawBody, signature, webhookSecretFor(cfg, "payin"))) {
    // Logged with a null txn id: an unverified payload is not something to
    // trust enough to dedupe on. The unique index ignores nulls, so repeated
    // forgeries cannot lock out a real delivery.
    logWebhook({
      event: "payin.updated",
      txnId: null,
      refId: null,
      status: null,
      signatureOk: false,
      outcome: "bad_signature",
      raw: rawBody,
    });
    return { status: 401, outcome: "bad_signature" };
  }

  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return { status: 400, outcome: "bad_json" };
  }

  const event = String(evt?.event || "payin.updated");
  if (!event.startsWith("payin."))
    return { status: 400, outcome: "wrong_event" };

  const txnId = String(evt?.id || "") || null;
  const orderId = String(evt?.order_id || "") || null;
  const status = String(evt?.status || "");
  if (!orderId || !status) return { status: 400, outcome: "missing_fields" };

  const fresh = logWebhook({
    event,
    txnId,
    refId: orderId,
    status,
    signatureOk: true,
    outcome: "received",
    raw: rawBody,
  });
  if (!fresh) return { status: 200, outcome: "duplicate" };

  /**
   * Record what we finally DID with this delivery.
   *
   * The row is inserted the moment a callback arrives, because that insert IS
   * the dedupe — but "arrived" and "credited" are very different facts, and a
   * log showing `received` for a callback we could not act on invites an
   * operator to conclude a payment landed when nothing moved. Every exit path
   * therefore states its own outcome.
   */
  const finish = (o: WebhookOutcome): WebhookOutcome => {
    try {
      db.prepare(
        "UPDATE payment_webhooks SET outcome = ? WHERE txn_id = ? AND status = ?",
      ).run(o.outcome, txnId, status);
    } catch {
      /* the log must never be the reason a callback fails */
    }
    return o;
  };

  const order = payinOrder(orderId);
  if (!order) {
    // Not recoverable by retrying, so acknowledge to stop 200 retries while
    // leaving the evidence in the log.
    return finish({
      status: 200,
      outcome: "unknown_order",
      note: `no order ${orderId}`,
    });
  }

  db.prepare(
    `UPDATE payment_orders
        SET status = ?, txn_id = COALESCE(?, txn_id), utr = COALESCE(?, utr),
            raw = ?, updated_at = ?
      WHERE order_id = ?`,
  ).run(
    status,
    txnId,
    evt?.utr ? String(evt.utr) : null,
    rawBody.slice(0, 4000),
    Date.now(),
    orderId,
  );

  if (status !== "success")
    return finish({
      status: 200,
      outcome: status === "failed" || status === "expired" ? status : "noted",
    });

  // Already credited on an earlier delivery that carried a different status
  // string — belt and braces on top of the two dedupe layers.
  const already = db
    .prepare(
      `SELECT id FROM trade_deposits WHERE user_id = ? AND idem = ? LIMIT 1`,
    )
    .get(order.user_id, `sunpay:${txnId || orderId}`) as
    | { id: number }
    | undefined;
  if (already) return { status: 200, outcome: "already_credited" };

  // The amount is OURS, never the callback's. A callback claiming a larger sum
  // than we asked for is a red flag, so it is recorded rather than acted on.
  const claimed = Number(evt?.amount);
  if (Number.isFinite(claimed) && Math.abs(claimed - order.amount) > 0.01) {
    db.prepare(
      "UPDATE payment_orders SET status = ?, updated_at = ? WHERE order_id = ?",
    ).run("amount_mismatch", Date.now(), orderId);
    logWebhook({
      event,
      txnId: txnId ? `${txnId}:mismatch` : null,
      refId: orderId,
      status: "amount_mismatch",
      signatureOk: true,
      outcome: "amount_mismatch",
      raw: rawBody,
    });
    return finish({
      status: 200,
      outcome: "amount_mismatch",
      note: `claimed ${claimed} vs order ${order.amount}`,
    });
  }

  const res = recordDeposit({
    key: order.user_id,
    amount: order.amount,
    method: "gateway",
    actor: "sunpay",
    note: [
      `Sunpays ${order.order_id}`,
      txnId ? `txn ${txnId}` : "",
      evt?.utr ? `UTR ${evt.utr}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300),
    idem: `sunpay:${txnId || orderId}`,
  });

  if (!res.ok) {
    // The ledger refused — most likely one of its own caps. Leave the order in
    // a state an operator will notice rather than silently dropping the money.
    db.prepare(
      "UPDATE payment_orders SET status = ?, updated_at = ? WHERE order_id = ?",
    ).run("paid_not_credited", Date.now(), orderId);
    return finish({ status: 500, outcome: "credit_refused", note: res.error });
  }

  return finish({
    status: 200,
    outcome: res.duplicate ? "duplicate" : "credited",
    credited: order.amount,
  });
}

/** What a user may have paid out, by our own ledger. Never the gateway's word. */
export function paidOutTotal(userId: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM payment_payouts
        WHERE user_id = ? AND status IN ('success','processing','pending')`,
    )
    .get(userId) as { t: number } | undefined;
  return Number(r?.t) || 0;
}

export type CreatePayoutOutcome =
  | { ok: true; payout: PayoutRow }
  | {
      ok: false;
      error: string;
      status: number;
      /**
       * Why it failed, passed through from the gateway client. The caller needs
       * it to decide whether the money may be retried: `network` might have been
       * sent, `auth`/`config`/`refused` definitely were not.
       */
      kind?: "auth" | "config" | "network" | "refused";
    };

/**
 * Send a payout.
 *
 * The ceiling is passed in as `budget`, computed by the caller from the ledger,
 * rather than derived here. That is deliberate: with withdrawals now holding
 * their own funds in `deriveAccount`, a payout that re-derived its own cap from
 * `deposits − already paid out` would double-count the hold and refuse a
 * perfectly valid withdrawal.
 *
 * `payoutId` may be supplied so the caller can make the transfer idempotent —
 * the withdrawal path passes the withdrawal's own id, which means a retry is
 * rejected by the provider as a duplicate instead of paying twice.
 */
export async function startPayout(input: {
  userId: string;
  amount: number;
  method: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  beneficiaryPhone?: string;
  ifsc?: string;
  bankName?: string;
  actor: string;
  notifyUrl?: string;
  /** Rupees this transfer may draw on, from the caller's own ledger maths. */
  budget: number;
  payoutId?: string;
}): Promise<CreatePayoutOutcome> {
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);

  if (!cfg.enabled)
    return {
      ok: false,
      error: "Online payments are switched off",
      status: 503,
      kind: "config",
    };
  if (!cfg.payoutsEnabled)
    return {
      ok: false,
      error: "Payouts are switched off",
      status: 503,
      kind: "config",
    };
  if (!railConfigured(cfg, "payout"))
    return {
      ok: false,
      error: "Payout rail is not configured",
      status: 503,
      kind: "config",
    };

  const amount = money2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Enter an amount above zero", status: 400 };
  if (!input.beneficiaryName || !input.beneficiaryAccount)
    return {
      ok: false,
      error: "Beneficiary name and account are required",
      status: 400,
    };
  if (input.method === "bank" && !input.ifsc)
    return {
      ok: false,
      error: "IFSC is required for a bank payout",
      status: 400,
    };

  const ceiling = money2(input.budget);
  if (amount > ceiling + 0.01)
    return {
      ok: false,
      error:
        `Withdrawable is ₹${Math.max(0, ceiling).toLocaleString("en-IN")}. ` +
        `Requests already awaiting approval are counted, so the same money ` +
        `cannot be sent twice.`,
      status: 400,
    };

  const payoutId = input.payoutId || newOrderId("PO");
  const now = Date.now();
  db.prepare(
    `INSERT INTO payment_payouts
       (payout_id, user_id, amount, currency, method, beneficiary_name,
        beneficiary_account, ifsc, bank_name, status, actor, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    payoutId,
    input.userId,
    amount,
    "INR",
    input.method,
    input.beneficiaryName,
    input.beneficiaryAccount,
    input.ifsc || null,
    input.bankName || null,
    "new",
    input.actor,
    now,
    now,
  );

  const res = await createPayout(cfg, {
    payoutId,
    amount,
    method: input.method,
    beneficiaryName: input.beneficiaryName,
    beneficiaryAccount: input.beneficiaryAccount,
    beneficiaryPhone: input.beneficiaryPhone,
    ifsc: input.ifsc,
    bankName: input.bankName,
    notifyUrl: input.notifyUrl,
  });

  if (!res.ok) {
    db.prepare(
      "UPDATE payment_payouts SET status = ?, note = ?, updated_at = ? WHERE payout_id = ?",
    ).run("failed", res.error.slice(0, 300), Date.now(), payoutId);
    // `kind` MUST be forwarded. A credential or configuration failure comes back
    // from the gateway as a 502 so the HTTP status alone cannot be trusted to
    // mean "the transfer may be in flight" — only this field can.
    return { ok: false, error: res.error, status: res.status, kind: res.kind };
  }

  const d = res.data;
  db.prepare(
    `UPDATE payment_payouts
        SET status = ?, fee = ?, net_amount = ?, raw = ?, updated_at = ?
      WHERE payout_id = ?`,
  ).run(
    d.status || "pending",
    d.fee ?? null,
    d.net_amount ?? null,
    JSON.stringify(d).slice(0, 4000),
    Date.now(),
    payoutId,
  );

  return {
    ok: true,
    payout: db
      .prepare("SELECT * FROM payment_payouts WHERE payout_id = ?")
      .get(payoutId) as PayoutRow,
  };
}

/**
 * Pay an approved withdrawal.
 *
 * Idempotent by construction: the gateway payout id IS the withdrawal id, and a
 * second call finds a status that is no longer `requested` or `approved`. Two
 * concurrent calls would still race, but the provider rejects the second on the
 * duplicate payout id, so the money moves at most once.
 *
 * The failure handling is the part worth reading. A definite rejection from the
 * gateway (a 4xx — bad account, below their minimum) means nothing was sent, so
 * the withdrawal is marked `failed` and the funds are released back to the
 * customer. A TIMEOUT is not a rejection: the transfer may well be in flight, so
 * the withdrawal is left `approved` for a human to check. Releasing funds on an
 * ambiguous error is how a customer gets paid twice, and it is the one mistake
 * here that cannot be undone afterwards.
 */
export async function payOutWithdrawal(
  id: string,
  actor: string,
  notifyUrl?: string,
): Promise<
  | { ok: true; withdrawal: any }
  | { ok: false; error: string; status: number; ambiguous?: boolean }
> {
  const w = withdrawalById(id);
  if (!w) return { ok: false, error: "No such withdrawal", status: 404 };
  if (w.status !== "requested" && w.status !== "approved")
    return {
      ok: false,
      error: `This withdrawal is already ${w.status}`,
      status: 409,
    };

  const acct = w.account_id ? payoutAccountById(w.user_id, w.account_id) : null;
  if (!acct)
    return {
      ok: false,
      error: "The account this was requested to no longer exists",
      status: 400,
    };

  // Configuration is checked BEFORE anything is written.
  //
  // This matters: an operator clicking Approve while the rail is switched off
  // must get an error, not a rejected customer request. Marking it rejected
  // would tell the customer their withdrawal was refused and hand them the money
  // back, when in truth nobody ever tried to send it.
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);
  if (!cfg.enabled)
    return {
      ok: false,
      error: "Online payments are switched off",
      status: 503,
    };
  if (!cfg.payoutsEnabled)
    return { ok: false, error: "Pay-outs are switched off", status: 503 };
  if (!railConfigured(cfg, "payout"))
    return { ok: false, error: "Payout rail is not configured", status: 503 };

  // Record the decision before the network hop, so a crash mid-send leaves an
  // auditable `approved` row rather than a `requested` one nobody acted on.
  markApproved(w.id, actor);

  const res = await startPayout({
    userId: w.user_id,
    amount: w.amount,
    method: acct.kind,
    beneficiaryName: acct.holder_name || "Account holder",
    beneficiaryAccount:
      (acct.kind === "upi" ? acct.upi_id : acct.account_number) || "",
    ifsc: acct.ifsc || undefined,
    bankName: acct.bank_name || undefined,
    actor,
    notifyUrl,
    // Already validated when it was requested, and the money is held by the
    // ledger — so the budget is the amount itself.
    budget: w.amount,
    payoutId: w.id,
  });

  if (!res.ok) {
    // Credentials or configuration: nothing was sent, so the request goes back
    // in the queue. Reporting this as "maybe it went through" would leave the
    // customer's money held on the strength of an error that says the opposite.
    if (res.kind === "auth" || res.kind === "config") {
      reopen(w.id);
      return {
        ok: false,
        error: `${res.error}. Nothing was sent — the withdrawal is back in the queue.`,
        status: 503,
      };
    }
    // Only an UNCLASSIFIED 5xx is ambiguous. A classified failure must never be
    // caught by the status check: the gateway answers a bad key with 502, and
    // treating that as "maybe it was sent" would hold the customer's money on
    // the strength of an error that says the opposite.
    if (
      res.kind === "network" ||
      (res.kind === undefined && res.status >= 500)
    ) {
      // Ambiguous: the transfer may be in flight, so a human has to look before
      // anyone retries. Releasing the funds here is how someone gets paid twice.
      return {
        ok: false,
        error: `${res.error}. The transfer may have been sent — check the gateway before retrying.`,
        status: 502,
        ambiguous: true,
      };
    }
    // A definite refusal (bad account, below the provider's own minimum) means
    // nothing moved, so the funds go back to the customer.
    markRejected(w.id, actor, `Gateway refused: ${res.error}`);
    return { ok: false, error: res.error, status: res.status };
  }

  attachPayout(w.id, res.payout.payout_id);
  return { ok: true, withdrawal: withdrawalById(w.id) };
}

/** Turn a request down, releasing the funds held against it. */
export function rejectWithdrawal(id: string, actor: string, reason: string) {
  const w = withdrawalById(id);
  if (!w)
    return { ok: false as const, error: "No such withdrawal", status: 404 };
  if (w.status !== "requested")
    return {
      ok: false as const,
      error: `This withdrawal is already ${w.status}`,
      status: 409,
    };
  if (!String(reason || "").trim())
    return {
      ok: false as const,
      error: "Give a reason — the customer sees it",
      status: 400,
    };
  markRejected(id, actor, reason);
  return { ok: true as const, withdrawal: withdrawalById(id)! };
}

/** Apply a payout callback. Same verification and dedupe rules as pay-ins. */
export async function applyPayoutWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookOutcome> {
  const s = await runtimeSettings();
  const cfg = sunpayConfig(s);
  if (!railConfigured(cfg, "payout"))
    return { status: 503, outcome: "not_configured" };

  if (!verifySignature(rawBody, signature, webhookSecretFor(cfg, "payout"))) {
    logWebhook({
      event: "payout.updated",
      txnId: null,
      refId: null,
      status: null,
      signatureOk: false,
      outcome: "bad_signature",
      raw: rawBody,
    });
    return { status: 401, outcome: "bad_signature" };
  }

  let evt: any;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return { status: 400, outcome: "bad_json" };
  }

  const event = String(evt?.event || "payout.updated");
  if (!event.startsWith("payout."))
    return { status: 400, outcome: "wrong_event" };

  const txnId = String(evt?.id || "") || null;
  const payoutId = String(evt?.payout_id || "") || null;
  const status = String(evt?.status || "");
  if (!payoutId || !status) return { status: 400, outcome: "missing_fields" };

  const fresh = logWebhook({
    event,
    txnId,
    refId: payoutId,
    status,
    signatureOk: true,
    outcome: "received",
    raw: rawBody,
  });
  if (!fresh) return { status: 200, outcome: "duplicate" };

  const row = db
    .prepare("SELECT * FROM payment_payouts WHERE payout_id = ?")
    .get(payoutId) as PayoutRow | undefined;

  // A withdrawal tracks the same event on the customer's side of the ledger.
  // This runs whether or not a gateway-level row exists, because the withdrawal
  // is the record the customer sees.
  syncFromPayout(payoutId, status, {
    utr: evt?.utr ? String(evt.utr) : null,
    fee: Number.isFinite(Number(evt?.fee)) ? Number(evt.fee) : null,
    net: Number.isFinite(Number(evt?.net_amount))
      ? Number(evt.net_amount)
      : null,
  });

  if (!row)
    return { status: 200, outcome: "withdrawal_updated", note: payoutId };

  db.prepare(
    `UPDATE payment_payouts
        SET status = ?, utr = COALESCE(?, utr), fee = COALESCE(?, fee),
            net_amount = COALESCE(?, net_amount), raw = ?, updated_at = ?
      WHERE payout_id = ?`,
  ).run(
    status,
    evt?.utr ? String(evt.utr) : null,
    Number.isFinite(Number(evt?.fee)) ? Number(evt.fee) : null,
    Number.isFinite(Number(evt?.net_amount)) ? Number(evt.net_amount) : null,
    rawBody.slice(0, 4000),
    Date.now(),
    payoutId,
  );

  return { status: 200, outcome: status };
}

export function recentWebhooks(limit = 100) {
  return db
    .prepare(
      `SELECT ts, event, txn_id, ref_id, status, signature_ok, outcome
         FROM payment_webhooks ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as any[];
}

/** Every pay-in order, newest first — the whole book, not one customer's. */
export function recentOrders(limit = 100) {
  return db
    .prepare(
      `SELECT order_id, user_id, amount, currency, method, status, txn_id,
              utr, created_at, updated_at
         FROM payment_orders ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as PaymentOrder[];
}

/** Every payout, newest first. */
export function recentPayouts(limit = 100): PayoutRow[] {
  return db
    .prepare(`SELECT * FROM payment_payouts ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as PayoutRow[];
}

/**
 * Money in and out, as our own ledger and order book tell it.
 *
 * `credited` is what actually reached customer balances, which is the number to
 * compare against the gateway's own balance — the two should agree once
 * settlement clears, and a gap is the thing an operator needs to see.
 */
export function reconciliation() {
  const credited = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM trade_deposits WHERE method = 'gateway'`,
    )
    .get() as { n: number; total: number };
  const paidOut = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM payment_payouts WHERE status = 'success'`,
    )
    .get() as { n: number; total: number };
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
         FROM payment_orders
        WHERE status IN ('new','pending','processing','failed','amount_mismatch')`,
    )
    .get() as { n: number; total: number };
  const unactionable = db
    .prepare(
      `SELECT COUNT(*) AS n FROM payment_webhooks
        WHERE outcome IN ('bad_signature','unknown_order','unknown_payout',
                          'amount_mismatch','credit_refused')`,
    )
    .get() as { n: number };
  return {
    creditedCount: Number(credited?.n) || 0,
    creditedTotal: Number(credited?.total) || 0,
    paidOutCount: Number(paidOut?.n) || 0,
    paidOutTotal: Number(paidOut?.total) || 0,
    openCount: Number(pending?.n) || 0,
    openTotal: Number(pending?.total) || 0,
    unactionableCallbacks: Number(unactionable?.n) || 0,
  };
}

/** Merchant balance at the gateway — the reconciliation figure. */
export async function gatewayBalance(cfg: SunpayConfig) {
  return merchantBalance(cfg, "INR");
}

export { isFinalStatus };
