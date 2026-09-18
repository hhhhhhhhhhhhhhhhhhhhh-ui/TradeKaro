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
