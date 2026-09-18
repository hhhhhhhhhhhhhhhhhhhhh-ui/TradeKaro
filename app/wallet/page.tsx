"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sileo } from "sileo";
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

const card = "rounded-xl border border-border bg-card";
const inputCls =
  "h-11 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-brand/50";
const btnPrimary =
  "pressable h-11 rounded-lg bg-foreground px-4 font-mono text-[12px] font-bold text-background disabled:opacity-50";
const btnGhost =
  "pressable h-11 rounded-lg border border-border px-4 font-mono text-[12px] font-bold text-foreground disabled:opacity-50";

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
    void load();
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
            : "Practice credit (not withdrawable)",
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
        <div className={`${card} p-6 text-sm text-muted-foreground`}>
          Loading your wallet…
        </div>
      </div>
    );
  }
  if (!wd) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className={`${card} p-6 text-sm text-muted-foreground`}>
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-foreground">
            Wallet
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Add money, withdraw it, and manage where it is sent.
          </p>
        </div>
      </div>

      {/* ── balance ── */}
      <div className={`${card} mb-3 p-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Wallet balance
            </div>
            <div className="display-num text-[28px] font-bold leading-tight text-foreground">
              {money(wd.walletBalance)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Available</div>
              <div className="display-num font-semibold text-foreground">
                {money(wd.withdrawable)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">On hold</div>
              <div className="display-num font-semibold text-foreground">
                {money(wd.withdrawn)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total added</div>
              <div className="display-num font-semibold text-foreground">
                {money(wd.deposited)}
              </div>
            </div>
          </div>
        </div>

        {wd.practiceCredit > 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
            You also have{" "}
            <span className="font-semibold text-foreground">
              {money(wd.practiceCredit)}
            </span>{" "}
            of practice credit. It can be traded with, but it was never paid in,
            so it cannot be withdrawn.
          </div>
        ) : null}

        {/* KYC, stated as progress toward what it unlocks */}
        {wd.kyc.required && !wd.kyc.eligible && wd.kyc.minDeposit > 0 ? (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
              <span>
                KYC · {money(wd.deposited)} of {money(wd.kyc.minDeposit)}
              </span>
              <span>{money(wd.kyc.remaining)} to go</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round(kycProgress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Withdrawals unlock once you have added {money(wd.kyc.minDeposit)}.
              Every deposit counts — online payments and credits from our team
              alike.
            </p>
          </div>
        ) : null}
        {!wd.kyc.required ? (
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            KYC is not required for withdrawals on this account.
          </p>
        ) : null}
      </div>

      {/* ── add money ── */}
      <div className={`${card} mb-3 p-4`}>
        <div className="mb-1 text-[13px] font-semibold text-foreground">
          Add money
        </div>
        {wd.deposit.enabled ? (
          <>
            <p className="mb-3 text-[11.5px] text-muted-foreground">
              Pay by UPI. Your balance is credited as soon as the payment is
              confirmed — usually within seconds.
              {wd.deposit.minAmount
                ? ` Min ${money(wd.deposit.minAmount)}`
                : ""}
              {wd.deposit.maxAmount
                ? ` · Max ${money(wd.deposit.maxAmount)}`
                : ""}
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() => setDepAmt(String(c))}
                  className="pressable h-8 rounded-full border border-border px-3 font-mono text-[11.5px] text-foreground"
                >
                  {money(c)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={depAmt}
                onChange={(e) => setDepAmt(e.target.value)}
                placeholder="Amount ₹"
                className={inputCls}
              />
              <button
                disabled={depBusy}
                onClick={() => pay(Number(depAmt))}
                className={btnPrimary}
              >
                {depBusy ? "OPENING…" : "PAY NOW"}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            Online payments are not switched on yet, so money cannot be added
            from here at the moment. Nothing will be credited to your account
            until they are.
          </p>
        )}
      </div>

      {/* ── withdraw ── */}
      <div className={`${card} mb-3 p-4`}>
        <div className="mb-1 text-[13px] font-semibold text-foreground">
          Withdraw
        </div>
        {!wd.withdraw.enabled ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            Withdrawals are switched off at the moment. You can still add money
            and save where you want it sent.
          </p>
        ) : wd.kyc.blocked ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            {wd.kyc.source === "user-required"
              ? `This account needs KYC before it can withdraw — it unlocks at ${money(wd.kyc.minDeposit)} added.`
              : `Add ${money(wd.kyc.minDeposit)} in total to unlock withdrawals. ${money(wd.kyc.remaining)} to go.`}
          </p>
        ) : !wd.accounts.length ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            Add a UPI ID or bank account below. Withdrawals are only ever sent
            to an account you have saved.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[11.5px] text-muted-foreground">
              Available {money(wd.withdrawable)}
              {wd.withdraw.min ? ` · Min ${money(wd.withdraw.min)}` : ""}
              {wd.withdraw.max ? ` · Max ${money(wd.withdraw.max)}` : ""}. A
              request holds the money straight away and is paid once our team
              approves it.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={wdAcct}
                onChange={(e) => setWdAcct(e.target.value)}
                className={`${inputCls} sm:max-w-[240px]`}
              >
                {wd.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.description}
                    {a.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={wdAmt}
                onChange={(e) => setWdAmt(e.target.value)}
                placeholder="Amount ₹"
                className={inputCls}
              />
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
      <div className={`${card} mb-3 p-4`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-foreground">
            Bank &amp; UPI accounts
          </div>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="pressable h-8 rounded-lg border border-border px-3 font-mono text-[11.5px] font-bold text-foreground"
          >
            {addOpen ? "CANCEL" : "+ ADD"}
          </button>
        </div>

        {!wd.accounts.length && !addOpen ? (
          <p className="text-[12px] text-muted-foreground">
            Nothing saved yet. Add a UPI ID or a bank account to be able to
            withdraw.
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {wd.accounts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[12.5px] text-foreground">
                  {a.description}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {a.kind === "upi" ? "UPI" : "Bank transfer"}
                  {a.isDefault ? " · default" : ""}
                </div>
              </div>
              <div className="flex gap-1.5">
                {!a.isDefault ? (
                  <button
                    disabled={acctBusy}
                    onClick={() => act("default", { id: a.id })}
                    className="pressable h-8 rounded-lg border border-border px-2.5 font-mono text-[11px] text-foreground disabled:opacity-50"
                  >
                    DEFAULT
                  </button>
                ) : null}
                <button
                  disabled={acctBusy}
                  onClick={() => removeAccount(a.id)}
                  className="pressable h-8 rounded-lg border border-border px-2.5 font-mono text-[11px] text-muted-foreground disabled:opacity-50"
                >
                  REMOVE
                </button>
              </div>
            </div>
          ))}
        </div>

        {addOpen ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex gap-1.5">
              {(["upi", "bank"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`pressable h-9 flex-1 rounded-lg border font-mono text-[11.5px] font-bold ${
                    kind === k
                      ? "border-brand/40 bg-brand/10 text-foreground"
                      : "border-border text-muted-foreground"
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
              className={inputCls}
            />
            {kind === "upi" ? (
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="name@bank"
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
                  className={inputCls}
                />
                <input
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="IFSC (e.g. HDFC0001234)"
                  className={inputCls}
                />
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Bank name (optional)"
                  className={inputCls}
                />
              </>
            )}
            <button
              disabled={acctBusy}
              onClick={addAccount}
              className={btnPrimary}
            >
              {acctBusy ? "SAVING…" : "SAVE ACCOUNT"}
            </button>
            <p className="text-[11px] text-muted-foreground">
              We only ever show the last four digits of a bank account. Payouts
              go to exactly the account you pick here — an operator cannot type
              a different destination.
            </p>
          </div>
        ) : null}

        {note ? (
          <p className="mt-2 text-[11.5px] text-positive">{note}</p>
        ) : null}
      </div>

      {/* ── history ── */}
      <div className={`${card} p-4`}>
        <div className="mb-2 text-[13px] font-semibold text-foreground">
          History
        </div>
        {!activity.length ? (
          <p className="text-[12px] text-muted-foreground">
            No deposits or withdrawals yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {activity.map((a) => (
              <div
                key={a.key}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-foreground">
                    {a.kindLabel}
                    {a.status ? (
                      <span className="ml-2 rounded border border-border px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
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
                  className={`display-num shrink-0 font-mono text-[13px] font-bold ${
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
