"use client";
import { useCallback, useEffect, useState } from "react";
import { sileo } from "sileo";
import {
  depositFunds,
  getNetSpent,
  getWalletBalance,
  useKycGate,
  useTradingAccount,
} from "@/app/lib/trading";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { money, moneySigned } from "@/app/lib/format";

// Real wallet ledger: seeded capital + deposits − what the fills consumed.
//
// The ADD button that used to live here wrote to localStorage, so the server
// never saw the money — it was removed rather than patched. Deposits now go
// through POST /api/trade/deposit: recorded server-side, they raise trading
// capital, and they are what the KYC requirement is measured against.

type Deposit = { id: number; ts: number; amount: number; method: string };

export default function FundsPanel(props: { remainingCash: number }) {
  const acct = useTradingAccount();
  const gate = useKycGate();
  const cfg = usePublicConfig();
  const payCfg = cfg.payments;
  const [amt, setAmt] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [log, setLog] = useState<Deposit[]>([]);

  // The withdrawal side. Fetched rather than derived: the allowed amount, the
  // limits and the account list all come from the server, so the form cannot
  // offer something the request would then be refused for.
  const [wd, setWd] = useState<any>(null);
  const [wdAmt, setWdAmt] = useState("");
  const [wdAcct, setWdAcct] = useState("");
  const [wdBusy, setWdBusy] = useState(false);

  // Unified broker-style wallet: seeded capital + deposits − fills − charges.
  const wallet =
    typeof window === "undefined"
      ? props.remainingCash
      : getWalletBalance(props.remainingCash);
  const spent = typeof window === "undefined" ? 0 : getNetSpent();
  const deposited = acct ? acct.deposited : 0;

  const loadLog = useCallback(async () => {
    try {
      const r = await fetch("/api/trade/deposit", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setLog(Array.isArray(j?.deposits) ? j.deposits : []);
    } catch {
      /* the wallet line above is server-sourced anyway */
    }
  }, []);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  // Pending gateway orders. Shown because the interesting failure is a customer
  // who paid and saw nothing change — that state is "pending" here, and being
  // able to see it beats being told "it will come through".
  useEffect(() => {
    if (!payCfg?.enabled) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/payments/payin", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const orders: any[] = Array.isArray(j?.orders) ? j.orders : [];
        if (alive)
          setPending(
            orders.filter(
              (o) => o.status === "pending" || o.status === "processing",
            ).length,
          );
      } catch {
        /* the panel works without this line */
      }
    })();
    return () => {
      alive = false;
    };
  }, [payCfg?.enabled]);

  const loadWithdrawals = useCallback(async () => {
    try {
      const r = await fetch("/api/withdrawals", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setWd(j);
      setWdAcct((cur: string) => cur || j?.accounts?.[0]?.id || "");
    } catch {
      /* the panel still works without it */
    }
  }, []);

  useEffect(() => {
    void loadWithdrawals();
  }, [loadWithdrawals]);

  /**
   * Ask for a withdrawal.
   *
   * Nothing is decided here: the amount, the account and whether this user is
   * allowed at all are all re-checked server-side, and the money stops being
   * available the moment the request is accepted — not when it is approved.
   */
  async function requestWithdrawalNow() {
    const amount = Number(wdAmt);
    if (!(amount > 0)) {
      sileo.error({ title: "Enter an amount above zero" });
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
        sileo.error({ title: j?.error || "Could not request that withdrawal" });
        return;
      }
      setWdAmt("");
      sileo.success({
        title: "Withdrawal requested",
        description: "It appears here once an operator approves it.",
      });
      await loadWithdrawals();
    } finally {
      setWdBusy(false);
    }
  }

  /**
   * Pay through the gateway.
   *
   * The browser never credits anything: it asks the server to create an order
   * and then leaves for the hosted checkout page. The balance changes only when
   * the gateway calls us back with a signature we can verify.
   */
  async function payOnline() {
    const amount = Number(amt);
    const min = Number(payCfg?.minAmount) || 0;
    const max = Number(payCfg?.maxAmount) || 0;
    if (!(amount > 0)) {
      sileo.error({ title: "Enter an amount above zero" });
      return;
    }
    if (min && amount < min) {
      sileo.error({ title: `Minimum online top-up is ${money(min)}` });
      return;
    }
    if (max && amount > max) {
      sileo.error({ title: `Maximum online top-up is ${money(max)}` });
      return;
    }
    setPayBusy(true);
    try {
      const r = await fetch("/api/payments/payin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: "upi" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.checkoutUrl) {
        setPayBusy(false);
        sileo.error({ title: j?.error || "Could not start the payment" });
        return;
      }
      // Full navigation, not a popup — the customer has to complete a UPI or
      // bank step, and mobile browsers block popups for exactly this.
      window.location.href = j.checkoutUrl;
    } catch (e: any) {
      setPayBusy(false);
      sileo.error({ title: e?.message || "Could not start the payment" });
    }
  }

  async function submit() {
    const amount = Number(amt);
    if (!(amount > 0)) {
      sileo.error({ title: "Enter an amount above zero" });
      return;
    }
    setBusy(true);
    const res = await depositFunds(amount);
    setBusy(false);
    if (!res.ok) {
      sileo.error({ title: res.error || "Deposit failed" });
      return;
    }
    sileo.success({
      title: `${money(amount)} added`,
      description: `Total deposited ${money(res.deposited || 0)}`,
    });
    void loadLog();
  }

  return (
    <div className="broker-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Funds · Wallet {money(wallet)}
        </span>
        <div className="flex w-full gap-1.5 sm:w-auto">
          <input
            type="number"
            min="1"
            value={amt}
            onChange={(e) => setAmt(parseFloat(e.target.value) || 0)}
            className="display-num h-11 flex-1 border border-border px-2 font-mono text-sm sm:w-28"
          />
          <button
            disabled={busy}
            onClick={submit}
            className="pressable h-11 bg-foreground px-4 font-mono text-[12px] font-bold text-background disabled:opacity-50"
          >
            {busy ? "ADDING…" : "DEPOSIT"}
          </button>
          {payCfg?.enabled ? (
            <button
              disabled={payBusy}
              onClick={payOnline}
              title={`Pay online by UPI or bank transfer (${money(
                Number(payCfg.minAmount) || 0,
              )} – ${money(Number(payCfg.maxAmount) || 0)})`}
              className="pressable h-11 border border-border px-4 font-mono text-[12px] font-bold disabled:opacity-50"
            >
              {payBusy ? "OPENING…" : "PAY ONLINE"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="text-foreground/70">Deposited {money(deposited)}</span>
        <span>Capital deployed {money(spent)}</span>
        {pending > 0 ? (
          <span className="text-muted-foreground">
            {pending} online payment{pending === 1 ? "" : "s"} awaiting
            confirmation
          </span>
        ) : null}
        {acct ? (
          <>
            <span className="text-foreground/70">
              Margin used {money(acct.marginUsed)} · {acct.marginPct}% (
              {acct.leverage}x)
            </span>
            <span
              className={
                acct.freeMargin >= 0 ? "text-positive" : "text-negative"
              }
            >
              Free margin {money(acct.freeMargin)}
            </span>
          </>
        ) : null}
      </div>

      {/* Withdrawals. Hidden until the rail is on, because a request nobody can
          pay is worse than no button at all. */}
      {wd?.enabled ? (
        <div className="mb-3 border-t border-border pt-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide text-foreground">
              Withdraw
            </span>
            <span className="text-foreground/70">
              Available {money(Number(wd.withdrawable) || 0)}
            </span>
            {Number(wd.withdrawn) > 0 ? (
              <span>Requested {money(Number(wd.withdrawn))}</span>
            ) : null}
            <span>
              Min {money(Number(wd.minWithdraw) || 0)} · Max{" "}
              {money(Number(wd.maxWithdraw) || 0)}
            </span>
          </div>

          {!wd.accounts?.length ? (
            <div className="text-[12px] text-muted-foreground">
              Add a UPI ID or bank account in{" "}
              <a href="/profile/banks" className="underline">
                Banks &amp; UPI
              </a>{" "}
              first — withdrawals are paid to an account you have saved, and the
              server needs it before it can send anything.
            </div>
          ) : !wd.kycEligible ? (
            <div className="text-[12px] text-muted-foreground">
              Complete KYC to withdraw. It unlocks once your deposits reach the
              amount set by the operator.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <select
                value={wdAcct}
                onChange={(e) => setWdAcct(e.target.value)}
                className="display-num h-11 min-w-[200px] border border-border px-2 text-[12.5px]"
              >
                {wd.accounts.map((a: any) => (
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
                className="display-num h-11 w-[130px] border border-border px-2 font-mono text-sm"
              />
              <button
                disabled={wdBusy}
                onClick={requestWithdrawalNow}
                className="pressable h-11 border border-border px-4 font-mono text-[12px] font-bold disabled:opacity-50"
              >
                {wdBusy ? "REQUESTING…" : "WITHDRAW"}
              </button>
            </div>
          )}

          {wd.withdrawals?.length ? (
            <div className="mt-2 flex flex-col gap-1">
              {wd.withdrawals.slice(0, 4).map((w: any) => (
                <div
                  key={w.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px]"
                >
                  <span className="font-mono">{money(Number(w.amount))}</span>
                  <span
                    className={
                      w.status === "success"
                        ? "text-positive"
                        : w.status === "rejected" || w.status === "failed"
                          ? "text-negative"
                          : "text-muted-foreground"
                    }
                  >
                    {w.status === "requested" ? "awaiting approval" : w.status}
                  </span>
                  <span className="text-muted-foreground">{w.destination}</span>
                  {w.reason ? (
                    <span className="text-negative">{w.reason}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Deposits are the gate on KYC, so the requirement belongs next to the
          box that moves it. */}
      {!gate.open ? (
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
            <span
              className={
                gate.eligible ? "text-positive" : "text-muted-foreground"
              }
            >
              {gate.eligible ? (
                <>KYC unlocked — deposit requirement met</>
              ) : (
                <>
                  KYC unlocks at {money(gate.required)} ·{" "}
                  <span className="font-semibold text-foreground">
                    {money(gate.remaining)}
                  </span>{" "}
                  left
                </>
              )}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${gate.eligible ? "bg-positive" : "brand-gradient"}`}
              style={{ width: `${gate.progress * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {log.length === 0 ? (
        <p className="font-mono text-[12px] text-foreground/50">
          No deposits yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {log.slice(0, 5).map((d) => (
            <div
              key={d.id}
              className="flex justify-between py-2 font-mono text-[12px]"
            >
              <span className="text-foreground/60">
                {d.method === "admin" ? "CREDIT" : "DEPOSIT"} ·{" "}
                {new Date(d.ts).toLocaleDateString("en-IN")}
              </span>
              <span className="display-num font-bold text-positive">
                {moneySigned(Math.abs(Number(d.amount) || 0))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
