"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { sileo } from "sileo";
import {
  FiArrowDownLeft,
  FiArrowUpRight,
  FiCheck,
  FiClock,
  FiCreditCard,
  FiPlus,
  FiShield,
  FiTrash2,
  FiZap,
} from "react-icons/fi";
import { money } from "@/app/lib/format";

// ── Wallet ──────────────────────────────────────────────────────────────────
//
// The one place money moves: deposit, withdraw, saved destinations, history.
//
// Everything on this page is read from `/api/wallet`, which is derived from the
// same ledger the write paths validate against. Nothing is computed here, and
// nothing is inferred — a money screen that disagrees with the server is worse
// than a slow one.
//
// ⚠️ There is deliberately NO "add funds without paying" control. Deposits go
// through the gateway and are credited only when its signed callback says the
// payment settled. A previous version of this app had a button that credited
// the ledger directly, which let any signed-in user mint ₹5,00,000 at a time and
// then withdraw it.

type Row = {
  id: number | string;
  ts?: number;
  requested_at?: number;
  amount: number;
  method?: string;
  status?: string;
  note?: string | null;
  reason?: string | null;
  destination?: string;
  utr?: string | null;
};

type Account = {
  id: string;
  kind: string;
  label?: string;
  isDefault: boolean;
  description: string;
};

type Wallet = {
  walletBalance: number;
  withdrawable: number;
  deposited: number;
  withdrawn: number;
  practiceCredit: number;
  tradingCapital: number;
  freeMargin: number;
  deposit: {
    state: string;
    enabled: boolean;
    minAmount: number;
    maxAmount: number;
  };
  withdraw: { enabled: boolean; min: number; max: number };
  kyc: {
    eligible: boolean;
    required: boolean;
    source: string;
    minDeposit: number;
    remaining: number;
    blocked: boolean;
  };
  accounts: Account[];
  deposits: Row[];
  withdrawals: Row[];
};

// ── presentation ──────────────────────────────────────────────────────────
//
// Styling only. Every figure on this page still comes straight from the server;
// nothing in here computes, rounds or infers a money value, because a money
// screen that disagrees with the ledger is worse than an ugly one.

const card = "broker-card p-5";

const inputCls =
  "h-12 w-full rounded-xl border border-border bg-background/60 px-3.5 font-mono text-[15px] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-[13px] placeholder:text-muted-foreground/60 focus:border-brand/60 focus:bg-background focus:ring-2 focus:ring-brand/15";

const btnPrimary =
  "btn-money pressable inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-6 font-mono text-[11.5px] font-bold uppercase tracking-wider text-brand-foreground disabled:opacity-60";

const btnGhost =
  "pressable inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background/40 px-4 font-mono text-[11.5px] font-bold uppercase tracking-wider text-foreground transition-colors hover:border-brand/40 disabled:opacity-50";

const btnSmall =
  "pressable inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground disabled:opacity-50";

/** Card section header: an icon chip, a title, an optional hint and control. */
function SectionHead({
  icon,
  title,
  hint,
  right,
}: {
  icon: ReactNode;
  title: string;
  hint?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand ring-1 ring-inset ring-brand/25">
          {icon}
        </span>
        <div>
          <div className="text-[14px] font-bold tracking-tight text-foreground">
            {title}
          </div>
          {hint ? (
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              {hint}
            </div>
          ) : null}
        </div>
      </div>
      {right}
    </div>
  );
}

/** The muted panel the conditional states fall back to. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/** One figure on the dark hero card. */
function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 backdrop-blur-sm">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/55">
        {label}
      </div>
      <div className="display-num mt-1 text-[13.5px] font-bold text-white">
        {money(value)}
      </div>
    </div>
  );
}

// ── device-only destinations, promoted once ────────────────────────────────
//
// Before payout destinations were stored server-side they lived in the browser.
// The promotion used to happen on /profile/banks, which is now a redirect into
// this page — so it has to happen HERE, or a customer who saved a bank account
// on the old version would open their wallet and find it gone.
const LEGACY_BANK_KEY = "fs_bank_accounts";
const LEGACY_UPI_KEY = "fs_upi_ids";

function legacyDeviceAccounts(): unknown[] {
  try {
    const banks = JSON.parse(localStorage.getItem(LEGACY_BANK_KEY) || "[]");
    const upis = JSON.parse(localStorage.getItem(LEGACY_UPI_KEY) || "[]");
    return [
      ...(Array.isArray(banks) ? banks : []).map((b: any) => ({
        ...b,
        kind: "bank",
      })),
      ...(Array.isArray(upis) ? upis : []).map((u: any) => ({
        ...u,
        kind: "upi",
      })),
    ];
  } catch {
    return [];
  }
}

function when(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WalletPage() {
  const [wd, setWd] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const [depAmt, setDepAmt] = useState("");
  const [depBusy, setDepBusy] = useState(false);

  const [wdAmt, setWdAmt] = useState("");
  const [wdAcct, setWdAcct] = useState("");
  const [wdBusy, setWdBusy] = useState(false);

  const [kind, setKind] = useState<"upi" | "bank">("upi");
  const [upiId, setUpiId] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/wallet", { cache: "no-store" });
    if (r.status === 401) {
      window.location.replace("/login?next=/wallet");
      return;
    }
    const j = await r.json().catch(() => null);
    if (j) {
      setWd(j as Wallet);
      setWdAcct((cur) => {
        const list: Account[] = j.accounts || [];
        if (cur && list.some((a) => a.id === cur)) return cur;
        return (list.find((a) => a.isDefault) || list[0])?.id || "";
      });
      const min = Number(j.deposit?.minAmount) || 0;
      setDepAmt((cur) => cur || String(min || 500));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      // Promote the device list BEFORE the first read, so the wallet already
      // includes accounts added before this change. The server ignores the call
      // once the account has entries of its own, so repeating it is harmless.
      const legacy = legacyDeviceAccounts();
      if (legacy.length) {
        const res = await fetch("/api/payout-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "import", accounts: legacy }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        // The device copy is dropped ONLY once the server has taken all of it.
        // Clearing it unconditionally — as this used to — meant an entry the
        // server rejected was deleted from the browser too, so the customer's
        // only copy of their bank details was gone for good. A leftover
        // localStorage key costs nothing; losing the account does not.
        if (res && Number(res.skipped) === 0) {
          try {
            localStorage.removeItem(LEGACY_BANK_KEY);
            localStorage.removeItem(LEGACY_UPI_KEY);
          } catch {
            /* nothing to clean */
          }
        }
      }
      await load();
    })();
  }, [load]);

  async function pay(amount: number) {
    if (!(amount > 0)) {
      sileo.error({ title: "Enter an amount above zero" });
      return;
    }
    const min = Number(wd?.deposit.minAmount) || 0;
    const max = Number(wd?.deposit.maxAmount) || 0;
    if (min && amount < min) {
      sileo.error({ title: `Minimum deposit is ${money(min)}` });
      return;
    }
    if (max && amount > max) {
      sileo.error({ title: `Maximum deposit is ${money(max)}` });
      return;
    }
    setDepBusy(true);
    try {
      const r = await fetch("/api/payments/payin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: "upi" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.checkoutUrl) {
        setDepBusy(false);
        sileo.error({ title: j?.error || "Could not start the payment" });
        return;
      }
      // Full navigation, not a popup: the customer completes a UPI or bank step
      // and mobile browsers block popups for exactly this.
      window.location.href = j.checkoutUrl;
    } catch (e: any) {
      setDepBusy(false);
      sileo.error({ title: e?.message || "Could not start the payment" });
    }
  }

  async function withdraw() {
    const amount = Number(wdAmt);
    if (!(amount > 0)) {
      sileo.error({ title: "Enter an amount above zero" });
      return;
    }
    if (!wdAcct) {
      sileo.error({ title: "Add a UPI ID or bank account first" });
      return;
    }
    setWdBusy(true);
    try {
      const r = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, accountId: wdAcct }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        sileo.error({ title: j?.error || "Could not request the withdrawal" });
        return;
      }
      setWdAmt("");
      sileo.success({
        title: "Withdrawal requested",
        description: `Tap the link in your notifications if our team asks for anything. ${money(amount)} is on hold until it is approved.`,
      });
      void load();
    } finally {
      setWdBusy(false);
    }
  }

  async function addAccount() {
    setAcctBusy(true);
    try {
      const body: Record<string, unknown> =
        kind === "upi"
          ? { action: "add", kind: "upi", upiId, holderName: holder }
          : {
              action: "add",
              kind: "bank",
              accountNumber: acctNo,
              ifsc,
              holderName: holder,
              bankName,
            };
      const r = await fetch("/api/payout-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        sileo.error({ title: j?.error || "Could not save that account" });
        return;
      }
      setUpiId("");
      setAcctNo("");
      setIfsc("");
      setHolder("");
      setBankName("");
      setAddOpen(false);
      setNote("Account saved. Withdrawals can be sent here.");
      void load();
    } finally {
      setAcctBusy(false);
    }
  }

  async function act(action: string, payload: Record<string, unknown>) {
    setAcctBusy(true);
    try {
      const r = await fetch("/api/payout-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        sileo.error({ title: j?.error || "Could not update accounts" });
        return;
      }
      void load();
    } finally {
      setAcctBusy(false);
    }
  }

  async function removeAccount(id: string) {
    setAcctBusy(true);
    try {
      const r = await fetch(
        `/api/payout-accounts?id=${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 409 carries the reason: a pending request points at this account and
        // deleting it would orphan a payout already in the operator's queue.
        sileo.error({ title: j?.error || "Could not remove that account" });
        return;
      }
      if (wdAcct === id) setWdAcct("");
      void load();
    } finally {
      setAcctBusy(false);
    }
  }

  // One list, newest first: a wallet statement reads better as one timeline than
  // as two tables the eye has to compare.
  const activity = useMemo(() => {
    const dep = (wd?.deposits || []).map((d) => ({
      key: `d${d.id}`,
      at: d.ts || 0,
      kindLabel: "Deposit",
      amount: Number(d.amount) || 0,
      direction: "in" as const,
      status: "",
      detail:
        d.method === "admin"
          ? "Credited by our team"
          : d.method === "gateway"
            ? "Paid online"
            : "Promotional credit (not withdrawable)",
    }));
    const wdr = (wd?.withdrawals || []).map((w) => ({
      key: `w${w.id}`,
      at: w.requested_at || 0,
      kindLabel: "Withdrawal",
      amount: Number(w.amount) || 0,
      direction: "out" as const,
      status: String(w.status || ""),
      detail: `${w.destination || ""}${w.reason ? ` · ${w.reason}` : ""}${
        w.utr ? ` · UTR ${w.utr}` : ""
      }`,
    }));
    return [...dep, ...wdr].sort((a, b) => b.at - a.at).slice(0, 40);
  }, [wd]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className={`${card} text-sm text-muted-foreground`}>
          Loading your wallet…
        </div>
      </div>
    );
  }
  if (!wd) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className={`${card} text-sm text-muted-foreground`}>
          Could not load your wallet. Try refreshing.
        </div>
      </div>
    );
  }

  const chips = [500, 1000, 5000, 10000];
  const kycProgress =
    wd.kyc.minDeposit > 0
      ? Math.max(0, Math.min(1, wd.deposited / wd.kyc.minDeposit))
      : 1;
  const kycPct = Math.round(kycProgress * 100);
  const heroStats: [string, number][] = [
    ["Available", wd.withdrawable],
    ["On hold", wd.withdrawn],
    ["Total added", wd.deposited],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      {/* ── header ── */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Money</div>
          <h1 className="mt-1 text-[26px] font-bold tracking-tight text-foreground sm:text-[30px]">
            Wallet
          </h1>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            Add money, withdraw it, and manage where it is sent.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              wd.deposit.enabled
                ? "bg-positive live-dot"
                : "bg-muted-foreground"
            }`}
          />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {wd.deposit.enabled ? "Payments live" : "Payments paused"}
          </span>
        </div>
      </div>

      {/* ── balance hero ──────────────────────────────────────────────────────
          Deliberately dark in both themes, the way a physical card is: this is
          the one figure the customer came for, so it gets the contrast. The
          numerals use `.display-num`, so the digits do not shuffle sideways as
          the balance changes. */}
      <div
        className="relative mb-3 overflow-hidden rounded-2xl p-5 text-white shadow-[0_28px_60px_-30px_rgba(4,55,50,1)] ring-1 ring-inset ring-white/12 sm:p-6"
        style={{
          backgroundImage:
            "linear-gradient(140deg, #06231f 0%, #0b3b36 45%, #0f766e 100%)",
        }}
      >
        {/* Glow and watermark: decorative only, never interactive. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(720px 260px at 88% -25%, rgba(190,242,100,0.30), transparent 62%), radial-gradient(520px 240px at -12% 120%, rgba(45,212,191,0.24), transparent 60%)",
          }}
        />
        <div className="pointer-events-none absolute -right-4 -top-12 select-none text-[200px] font-black leading-none text-white/[0.055]">
          T
        </div>

        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
                Wallet balance
              </div>
              <div className="display-num mt-2 text-[36px] font-bold leading-none tracking-tight sm:text-[44px]">
                {money(wd.walletBalance)}
              </div>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/85 backdrop-blur">
              <FiShield size={18} />
            </span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {heroStats.map(([label, v]) => (
              <HeroStat key={label} label={label} value={v} />
            ))}
          </div>

          {wd.practiceCredit > 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-white/70 backdrop-blur-sm">
              You also have{" "}
              <span className="display-num font-bold text-white">
                {money(wd.practiceCredit)}
              </span>{" "}
              of promotional credit. It can be traded with, but it was never
              paid in, so it cannot be withdrawn.
            </div>
          ) : null}

          {/* KYC, stated as progress toward what it unlocks */}
          {wd.kyc.required && !wd.kyc.eligible && wd.kyc.minDeposit > 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3 backdrop-blur-sm">
              <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
                <span className="font-semibold text-white/85">
                  KYC ·{" "}
                  <span className="display-num">{money(wd.deposited)}</span> of{" "}
                  <span className="display-num">
                    {money(wd.kyc.minDeposit)}
                  </span>
                </span>
                <span className="display-num text-white/60">
                  {money(wd.kyc.remaining)} to go
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="brand-gradient h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${kycPct}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/60">
                Withdrawals unlock once you have added{" "}
                {money(wd.kyc.minDeposit)}. Every deposit counts — online
                payments and credits from our team alike.
              </p>
            </div>
          ) : null}
          {!wd.kyc.required ? (
            <p className="mt-3 text-[11px] text-white/60">
              KYC is not required for withdrawals on this account.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── add money ── */}
      <div className={`${card} mb-3`}>
        <SectionHead
          icon={<FiZap size={16} />}
          title="Add money"
          hint="Pay by UPI"
        />
        {wd.deposit.enabled ? (
          <>
            <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Your balance is credited as soon as the payment is confirmed —
              usually within seconds.
              {wd.deposit.minAmount
                ? ` Min ${money(wd.deposit.minAmount)}`
                : ""}
              {wd.deposit.maxAmount
                ? ` · Max ${money(wd.deposit.maxAmount)}`
                : ""}
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {chips.map((c) => {
                // Highlighting the chip whose amount is in the box is styling,
                // not behaviour — the value still comes from `depAmt`.
                const on = Number(depAmt) === c;
                return (
                  <button
                    key={c}
                    onClick={() => setDepAmt(String(c))}
                    aria-pressed={on}
                    className={`pressable h-8 rounded-full border px-3.5 font-mono text-[11.5px] font-semibold transition-colors ${
                      on
                        ? "border-brand/50 bg-brand/12 text-brand"
                        : "border-border bg-background/40 text-muted-foreground hover:border-brand/40 hover:text-foreground"
                    }`}
                  >
                    {money(c)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[16px] font-semibold text-muted-foreground/70">
                  ₹
                </span>
                <input
                  type="number"
                  min="1"
                  value={depAmt}
                  onChange={(e) => setDepAmt(e.target.value)}
                  placeholder="Amount"
                  aria-label="Amount to add"
                  className={`${inputCls} pl-9 font-bold`}
                />
              </div>
              <button
                disabled={depBusy}
                onClick={() => pay(Number(depAmt))}
                className={btnPrimary}
              >
                {depBusy ? (
                  "OPENING…"
                ) : (
                  <>
                    PAY NOW
                    <FiArrowUpRight size={14} />
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <Notice>
            Online payments are not switched on yet, so money cannot be added
            from here at the moment. Nothing will be credited to your account
            until they are.
          </Notice>
        )}
      </div>

      {/* ── withdraw ── */}
      <div className={`${card} mb-3`}>
        <SectionHead
          icon={<FiArrowUpRight size={16} />}
          title="Withdraw"
          hint="Paid out to an account you have saved"
        />
        {!wd.withdraw.enabled ? (
          <Notice>
            Withdrawals are switched off at the moment. You can still add money
            and save where you want it sent.
          </Notice>
        ) : wd.kyc.blocked ? (
          <Notice>
            {wd.kyc.source === "user-required"
              ? `This account needs KYC before it can withdraw — it unlocks at ${money(wd.kyc.minDeposit)} added.`
              : `Add ${money(wd.kyc.minDeposit)} in total to unlock withdrawals. ${money(wd.kyc.remaining)} to go.`}
          </Notice>
        ) : !wd.accounts.length ? (
          <Notice>
            Add a UPI ID or bank account below. Withdrawals are only ever sent
            to an account you have saved.
          </Notice>
        ) : (
          <>
            <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Available{" "}
              <span className="display-num font-semibold text-foreground">
                {money(wd.withdrawable)}
              </span>
              {wd.withdraw.min ? ` · Min ${money(wd.withdraw.min)}` : ""}
              {wd.withdraw.max ? ` · Max ${money(wd.withdraw.max)}` : ""}. A
              request holds the money straight away and is paid once our team
              approves it.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={wdAcct}
                onChange={(e) => setWdAcct(e.target.value)}
                aria-label="Destination account"
                className={`${inputCls} sm:max-w-[240px]`}
              >
                {wd.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.description}
                    {a.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[16px] font-semibold text-muted-foreground/70">
                  ₹
                </span>
                <input
                  type="number"
                  min="1"
                  value={wdAmt}
                  onChange={(e) => setWdAmt(e.target.value)}
                  placeholder="Amount"
                  aria-label="Amount to withdraw"
                  className={`${inputCls} pl-9 font-bold`}
                />
              </div>
              <button
                disabled={wdBusy}
                onClick={withdraw}
                className={btnPrimary}
              >
                {wdBusy ? "REQUESTING…" : "WITHDRAW"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── destinations ── */}
      <div className={`${card} mb-3`}>
        <SectionHead
          icon={<FiCreditCard size={16} />}
          title="Bank & UPI accounts"
          hint="Where your money can be sent"
          right={
            <button
              onClick={() => setAddOpen((v) => !v)}
              className={
                addOpen
                  ? btnSmall
                  : "pressable inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand/12 px-3 font-mono text-[10.5px] font-bold uppercase tracking-wider text-brand ring-1 ring-inset ring-brand/25 transition-colors hover:bg-brand/20"
              }
            >
              {addOpen ? (
                "CANCEL"
              ) : (
                <>
                  <FiPlus size={12} />
                  ADD
                </>
              )}
            </button>
          }
        />

        {!wd.accounts.length && !addOpen ? (
          <p className="text-[12px] text-muted-foreground">
            Nothing saved yet. Add a UPI ID or a bank account to be able to
            withdraw.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {wd.accounts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3.5 py-3 transition-colors hover:border-brand/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FiCreditCard size={15} />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12.5px] font-semibold text-foreground">
                    {a.description}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{a.kind === "upi" ? "UPI" : "Bank transfer"}</span>
                    {a.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-brand">
                        <FiCheck size={9} />
                        Default
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                {!a.isDefault ? (
                  <button
                    disabled={acctBusy}
                    onClick={() => act("default", { id: a.id })}
                    className={btnSmall}
                  >
                    DEFAULT
                  </button>
                ) : null}
                <button
                  disabled={acctBusy}
                  onClick={() => removeAccount(a.id)}
                  aria-label={`Remove ${a.description}`}
                  className="pressable inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-negative/50 hover:text-negative disabled:opacity-50"
                >
                  <FiTrash2 size={12} />
                  REMOVE
                </button>
              </div>
            </div>
          ))}
        </div>

        {addOpen ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex gap-1.5 rounded-xl border border-border bg-muted/40 p-1">
              {(["upi", "bank"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`pressable h-9 flex-1 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    kind === k
                      ? "bg-brand text-brand-foreground shadow-[0_6px_16px_-10px_rgb(var(--brand)/0.9)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k === "upi" ? "UPI ID" : "BANK ACCOUNT"}
                </button>
              ))}
            </div>
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder="Account holder name"
              aria-label="Account holder name"
              className={inputCls}
            />
            {kind === "upi" ? (
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="name@bank"
                aria-label="UPI ID"
                className={inputCls}
              />
            ) : (
              <>
                <input
                  value={acctNo}
                  onChange={(e) =>
                    setAcctNo(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="Account number"
                  aria-label="Account number"
                  className={inputCls}
                />
                <input
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="IFSC (e.g. HDFC0001234)"
                  aria-label="IFSC"
                  className={inputCls}
                />
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Bank name (optional)"
                  aria-label="Bank name"
                  className={inputCls}
                />
              </>
            )}
            <button
              disabled={acctBusy}
              onClick={addAccount}
              className={btnPrimary}
            >
              {acctBusy ? (
                "SAVING…"
              ) : (
                <>
                  <FiPlus size={14} />
                  SAVE ACCOUNT
                </>
              )}
            </button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              We only ever show the last four digits of a bank account. Payouts
              go to exactly the account you pick here — an operator cannot type
              a different destination.
            </p>
          </div>
        ) : null}

        {note ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-positive/10 px-2.5 py-1.5 text-[11.5px] font-medium text-positive">
            <FiCheck size={12} />
            {note}
          </p>
        ) : null}
      </div>

      {/* ── history ── */}
      <div className={card}>
        <SectionHead
          icon={<FiClock size={16} />}
          title="History"
          hint="Newest first"
        />
        {!activity.length ? (
          <p className="text-[12px] text-muted-foreground">
            No deposits or withdrawals yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {activity.map((a) => (
              <div
                key={a.key}
                className="row-slide flex items-center gap-3 py-3"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    a.direction === "in"
                      ? "bg-positive/12 text-positive"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.direction === "in" ? (
                    <FiArrowDownLeft size={15} />
                  ) : (
                    <FiArrowUpRight size={15} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {a.kindLabel}
                    </span>
                    {a.status ? (
                      <span className="rounded-full border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        {a.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {when(a.at)}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </div>
                </div>
                <div
                  className={`display-num shrink-0 text-[13.5px] font-bold ${
                    a.direction === "in" ? "text-positive" : "text-foreground"
                  }`}
                >
                  {a.direction === "in" ? "+" : "−"}
                  {money(a.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
