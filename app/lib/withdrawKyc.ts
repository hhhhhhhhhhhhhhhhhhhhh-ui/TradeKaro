// Must a withdrawal clear the KYC gate?
//
// Two levels, because the honest answer differs per account: a site-wide default
// and a per-user override. The override is deliberately THREE-valued. With only
// two states you could say "KYC for everyone" or "KYC for nobody", but not "KYC
// for everyone except this one client" — which is the real commercial case: a
// walk-in who paid by cheque and whose paperwork is still in the post, a staff
// account, or one customer you have already verified by hand.
//
// This module imports NOTHING so the browser and the server can share it: the
// panel uses it to decide what to render, and the server uses it to decide what
// to allow. The server's answer always wins; the client copy exists only so the
// form does not offer something the request would refuse.

export const WITHDRAW_KYC_MODES = ["inherit", "require", "waive"] as const;

export type WithdrawKycMode = (typeof WITHDRAW_KYC_MODES)[number];

export function isWithdrawKycMode(v: unknown): v is WithdrawKycMode {
  return (WITHDRAW_KYC_MODES as readonly string[]).includes(
    String(v ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** Anything unrecognised reads as "follow the site", never as an exemption. */
export function normalizeWithdrawKyc(v: unknown): WithdrawKycMode {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return isWithdrawKycMode(s) ? (s as WithdrawKycMode) : "inherit";
}

export type KycResolution = {
  required: boolean;
  /** Where the answer came from, for the console and for the customer copy. */
  source: "site" | "user-required" | "user-waived";
};

/**
 * The one rule, in one place.
 *
 * A per-user answer always beats the site default, in BOTH directions: a
 * `require` override still applies where the site waived KYC, and a `waive`
 * override still applies where the site demands it. "Otherwise the site decides"
 * is what `inherit` means, and it is the default for every account.
 */
export function resolveWithdrawKyc(
  mode: unknown,
  siteRequires: unknown,
): KycResolution {
  const m = normalizeWithdrawKyc(mode);
  if (m === "require") return { required: true, source: "user-required" };
  if (m === "waive") return { required: false, source: "user-waived" };
  return { required: siteRequires === true, source: "site" };
}

/** Operator-facing label for one user's setting. */
export function withdrawKycLabel(mode: unknown): string {
  const m = normalizeWithdrawKyc(mode);
  if (m === "require") return "Required for this user";
  if (m === "waive") return "Not required for this user";
  return "Follow the platform setting";
}
