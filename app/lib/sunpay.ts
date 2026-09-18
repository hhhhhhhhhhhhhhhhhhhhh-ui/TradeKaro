import crypto from "crypto";
import type { AdminSettings } from "./adminStore";

// Sunpays payment gateway client.  ── SERVER ONLY ──
//
// Never import this from a component. The API secret is the only thing standing
// between a stranger and a forged "this customer paid ₹50,000" webhook, and the
// gateway's own docs put it plainly: all calls must originate from your backend.
//
// The whole contract with this provider boils down to three facts:
//
//   1. The request signature is HMAC-SHA256 over the EXACT BYTES of the body.
//      So `JSON.stringify` once, sign that string, and send that same string as
//      the request body. Serialising twice — or pretty-printing after signing —
//      produces a signature that cannot match. `call()` below is structured so
//      there is only ever one string.
//   2. Pay-in and payout have SEPARATE key pairs. Mixing them fails
//      authentication in a way that looks like a wrong key, so the pair is
//      chosen by the caller's `rail` and never by a default.
//   3. GET endpoints authenticate with the API key alone. Only requests with a
//      body carry a signature — matching the provider's own curl examples.
//
// Every function returns a result object rather than throwing. A gateway call is
// a network hop to a third party; a thrown error here would surface to the user
// as a generic 500 with no way to tell "declined" from "unreachable".

const DEFAULT_BASE = "https://ttpay.business/api/public/v1";

/** Timeout for every gateway call. A hung gateway must not hold a request open. */
const TIMEOUT_MS = 15000;

export type SunpayConfig = {
  baseUrl: string;
  payinApiKey: string;
  payinApiSecret: string;
  payoutApiKey: string;
  payoutApiSecret: string;
  /**
   * The secret the PROVIDER signs callbacks with.
   *
   * ⚠️ This is NOT the API secret. The merchant dashboard shows "Webhook
   * secret — we sign callback POSTs to your notify URL with this secret", and
   * the two are different values. Verifying with the API secret instead makes
   * every callback fail with a bad signature, which presents as "deposits are
   * never credited automatically" and points nowhere near the cause.
   *
   * Empty falls back to the API secret, because some accounts are issued the
   * same value for both and a blank field must not break a working setup.
   */
  webhookSecret: string;
  enabled: boolean;
  payoutsEnabled: boolean;
  minAmount: number;
  maxAmount: number;
};

/**
 * The secret to verify a callback against.
 *
 * The webhook secret wins when it is set; otherwise the rail's own API secret,
 * which is what a single-secret account signs with.
 */
export function webhookSecretFor(cfg: SunpayConfig, rail: Rail): string {
  if (cfg.webhookSecret) return cfg.webhookSecret;
  return rail === "payin" ? cfg.payinApiSecret : cfg.payoutApiSecret;
}

export type GatewayResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      status: number;
      /**
       * What KIND of failure this was. The distinction decides whether money can
       * be retried, so it is classified here rather than guessed by the caller:
       *
       *   auth    — our credentials or signature are wrong. Nothing was sent.
       *   config  — the rail is disabled at the provider. Nothing was sent.
       *   network — timed out or unreachable. THE TRANSFER MAY BE IN FLIGHT.
       *   refused — the provider said no to this specific transfer. Nothing sent.
       */
      kind?: "auth" | "config" | "network" | "refused";
    };

/**
 * Where the credentials come from.
 *
 * The settings row wins and the environment is the fallback, matching how the
 * rest of this app is configured — the admin console is the control plane, and
 * `upstoxToken` works the same way. A hardened deployment can set the env vars
 * and leave the settings row empty; both paths work, and empty always means
 * "not configured" rather than "authenticate with an empty string".
 */
export function sunpayConfig(s: AdminSettings): SunpayConfig {
  const p = s.payments;
  const env = (k: string) => String(process.env[k] || "").trim();
  return {
    baseUrl: (env("SUNPAY_BASE_URL") || p?.baseUrl || DEFAULT_BASE).replace(
      /\/+$/,
      "",
    ),
    payinApiKey: env("SUNPAY_PAYIN_API_KEY") || p?.payinApiKey || "",
    payinApiSecret: env("SUNPAY_PAYIN_API_SECRET") || p?.payinApiSecret || "",
    payoutApiKey: env("SUNPAY_PAYOUT_API_KEY") || p?.payoutApiKey || "",
    payoutApiSecret:
      env("SUNPAY_PAYOUT_API_SECRET") || p?.payoutApiSecret || "",
    webhookSecret: env("SUNPAY_WEBHOOK_SECRET") || p?.webhookSecret || "",
    enabled: p?.enabled === true,
    payoutsEnabled: p?.payoutsEnabled === true,
    minAmount: Number(p?.minAmount) > 0 ? Number(p.minAmount) : 100,
    maxAmount: Number(p?.maxAmount) > 0 ? Number(p.maxAmount) : 100000,
  };
}

/** True when a rail has both halves of its key pair. Never log the values. */
export function railConfigured(cfg: SunpayConfig, rail: Rail): boolean {
  return rail === "payin"
    ? !!(cfg.payinApiKey && cfg.payinApiSecret)
    : !!(cfg.payoutApiKey && cfg.payoutApiSecret);
}

/** A short, safe description of what is missing, for the admin panel. */
export function configGap(cfg: SunpayConfig): string | null {
  if (!cfg.enabled) return "Payments are switched off";
  if (!railConfigured(cfg, "payin")) return "Pay-in key or secret is missing";
  return null;
}

export type Rail = "payin" | "payout";

/** HMAC-SHA256 hex digest of the raw body. */
export function signBody(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a signature we computed against one we were sent.
 *
 * `===` on a hex digest leaks, through timing, how many leading characters were
 * right — which is enough to forge a signature character by character given
 * enough attempts. `timingSafeEqual` also throws on length mismatch, so the
 * lengths are compared first and unequal lengths are rejected outright.
 */
export function verifySignature(
  raw: string,
  given: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signBody(raw, secret), "utf8");
  const received = Buffer.from(String(given || ""), "utf8");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

type CallArgs = {
  cfg: SunpayConfig;
  rail: Rail;
  path: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
};

/**
 * One gateway call.
 *
 * The body is stringified exactly once and that same string is signed and sent,
 * which is the property the provider's HMAC check depends on. Nothing here
 * re-serialises.
 */
async function call<T>({
  cfg,
  rail,
  path,
  method,
  body,
}: CallArgs): Promise<GatewayResult<T>> {
  const key = rail === "payin" ? cfg.payinApiKey : cfg.payoutApiKey;
  const secret = rail === "payin" ? cfg.payinApiSecret : cfg.payoutApiSecret;
  if (!key || !secret)
    return {
      ok: false,
      error:
        rail === "payin"
          ? "Pay-in API key/secret not configured"
          : "Payout API key/secret not configured",
      status: 503,
    };

  const raw = body ? JSON.stringify(body) : "";
  const headers: Record<string, string> = { accept: "application/json" };
  if (raw) {
    headers["content-type"] = "application/json";
    headers["x-api-key"] = key;
    headers["x-signature"] = signBody(raw, secret);
  } else {
    // GETs take the key alone — see the provider's status/balance examples.
    headers["x-api-key"] = key;
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers,
      body: raw || undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      ok: false,
      error: timedOut
        ? `Gateway did not respond in ${TIMEOUT_MS / 1000}s`
        : `Could not reach the gateway: ${e?.message || e}`,
      status: 504,
      kind: "network",
    };
  }

  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON — keep the text for the error below */
  }

  if (!res.ok || parsed?.error) {
    // The provider's error codes are stable strings (invalid_signature,
    // insufficient_balance, …) and are far more useful than the HTTP status.
    const code =
      parsed?.error ||
      parsed?.message ||
      (text ? text.slice(0, 160) : `HTTP ${res.status}`);

    // Configuration and credential failures are OUR problem, not a decision
    // about this transfer — and they are the ones that must not be mistaken for
    // "maybe it went through", because retrying them is safe and retrying a
    // timeout is not.
    const CONFIG_CODES = new Set([
      "payout_disabled",
      "payin_disabled",
      "merchant_inactive",
      "channel_not_found",
      "channel_inactive",
      "channel_not_configured",
      "channel_direct_dependency_unmet",
    ]);
    const kind =
      res.status === 401 || res.status === 403
        ? "auth"
        : CONFIG_CODES.has(String(code))
          ? "config"
          : "refused";

    return {
      ok: false,
      // A signature mismatch is our bug, not the user's, so say so plainly
      // rather than passing "invalid_signature" through to a customer.
      //
      // The wording names the likely cause, because it is nearly always the
      // same one: the KEY was accepted (a wrong key answers `invalid_api_key`
      // instead) and only the signature failed, which means the secret sitting
      // beside that key is not the secret that belongs to it — a swapped
      // pay-in/payout pair, or a secret pasted into the key's box.
      error:
        code === "invalid_signature"
          ? `Gateway rejected our signature — the ${rail} key was accepted but the ${rail} secret does not match it. Check that this key and secret were copied from the same row of the merchant dashboard (and that neither was taken from the other rail).`
          : code === "invalid_api_key"
            ? `Gateway rejected our API key — the ${rail} key itself is not valid. Check which key is loaded.`
            : String(code),
      status:
        res.status === 401 || res.status === 403
          ? 502
          : res.status >= 400
            ? res.status
            : 502,
      kind,
    };
  }

  return { ok: true, data: parsed as T };
}

/** Amounts are in major units; this keeps them at two decimals of paise. */
export function money2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

export type PayinCreated = {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  method?: string;
  checkout_url?: string;
  payment_url?: string;
  redirect_url?: string;
  created_at?: string;
};

export function createPayin(
  cfg: SunpayConfig,
  input: {
    orderId: string;
    amount: number;
    currency?: string;
    method?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    notifyUrl?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<GatewayResult<PayinCreated>> {
  const body: Record<string, unknown> = {
    order_id: input.orderId,
    amount: money2(input.amount),
    currency: input.currency || "INR",
    method: input.method || "upi",
  };
  // Only send what we actually have: an empty string is a value the gateway
  // would have to interpret, and `undefined` is dropped by JSON.stringify.
  if (input.customerName) body.customer_name = input.customerName;
  if (input.customerPhone) body.customer_phone = input.customerPhone;
  if (input.customerEmail) body.customer_email = input.customerEmail;
  if (input.notifyUrl) body.notify_url = input.notifyUrl;
  if (input.metadata) body.metadata = input.metadata;

  return call<PayinCreated>({
    cfg,
    rail: "payin",
    path: "/payins",
    method: "POST",
    body,
  });
}

export type PayoutCreated = {
  id: string;
  payout_id: string;
  status: string;
  amount: number;
  fee?: number;
  net_amount?: number;
  currency: string;
  method: string;
  created_at?: string;
};

export function createPayout(
  cfg: SunpayConfig,
  input: {
    payoutId: string;
    amount: number;
    currency?: string;
    method: string;
    beneficiaryName: string;
    beneficiaryAccount: string;
    beneficiaryPhone?: string;
    ifsc?: string;
    bankName?: string;
    notifyUrl?: string;
  },
): Promise<GatewayResult<PayoutCreated>> {
  const body: Record<string, unknown> = {
    payout_id: input.payoutId,
    amount: money2(input.amount),
    currency: input.currency || "INR",
    method: input.method,
    beneficiary_name: input.beneficiaryName,
    beneficiary_account: input.beneficiaryAccount,
  };
  if (input.beneficiaryPhone) body.beneficiary_phone = input.beneficiaryPhone;
  if (input.ifsc) body.ifsc = input.ifsc;
  if (input.bankName) body.bank_name = input.bankName;
  if (input.notifyUrl) body.notify_url = input.notifyUrl;

  return call<PayoutCreated>({
    cfg,
    rail: "payout",
    path: "/payouts",
    method: "POST",
    body,
  });
}

export type PayoutStatus = {
  id: string;
  payout_id: string;
  status: string;
  amount: number;
  net_amount?: number;
  utr?: string;
};

export function payoutStatus(
  cfg: SunpayConfig,
  payoutId: string,
): Promise<GatewayResult<PayoutStatus>> {
  return call<PayoutStatus>({
    cfg,
    rail: "payout",
    path: `/payouts/status/${encodeURIComponent(payoutId)}`,
    method: "GET",
  });
}

export type MerchantBalance = {
  currency: string;
  balance: number;
  upstream_balance?: number;
};

export function merchantBalance(
  cfg: SunpayConfig,
  currency = "INR",
): Promise<GatewayResult<MerchantBalance>> {
  return call<MerchantBalance>({
    cfg,
    rail: "payout",
    path: `/balance?currency=${encodeURIComponent(currency)}`,
    method: "GET",
  });
}

/** The five states the provider documents. */
export type PayinStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "expired";

/** Final states never change again, so a webhook for one is settled business. */
export function isFinalStatus(s: string): boolean {
  return s === "success" || s === "failed" || s === "expired";
}
