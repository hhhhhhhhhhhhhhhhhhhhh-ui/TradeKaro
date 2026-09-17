// KYC deposit gate — pure maths, safe to import from both the server and the
// browser. The server value in the trading account is authoritative; this only
// exists so the client can render the same rule without a round trip.

/** Deposit requirements offered as one-click presets in the admin panel. */
export const KYC_DEPOSIT_PRESETS = [0, 10_000, 20_000, 25_000, 50_000];

export function normalizeMinDeposit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Whole rupees — a fractional requirement would be a bug, not a feature.
  return Math.round(n);
}

export type KycGate = {
  /** 0 means the gate is off and everyone may complete KYC. */
  required: number;
  deposited: number;
  remaining: number;
  eligible: boolean;
  /** The gate is disabled entirely — `remaining` and progress are meaningless. */
  open: boolean;
  /** 0..1, safe to feed straight into a bar width. */
  progress: number;
};

export function kycGate(deposited: unknown, minDeposit: unknown): KycGate {
  const required = normalizeMinDeposit(minDeposit);
  const have = Math.max(0, Number(deposited) || 0);
  const open = required <= 0;
  const eligible = open || have >= required;
  return {
    required,
    deposited: have,
    remaining: open ? 0 : Math.max(0, required - have),
    eligible,
    open,
    progress: open ? 1 : Math.min(1, have / required),
  };
}
