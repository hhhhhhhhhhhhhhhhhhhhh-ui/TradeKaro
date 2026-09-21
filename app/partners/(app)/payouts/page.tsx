"use client";

// Payouts — request money, manage where it goes.
//
// There is no automatic payout here, and that is the design: a UPI transfer and a
// USDT transfer are both irreversible, so the money is sent by a human after a
// human checks the destination. A partner can see every request, what it was for
// and the reference once it has been paid.

import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiCreditCard,
  FiPlus,
  FiStar,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import {
  copyText,
  inr,
  pGet,
  pPost,
  shortDate,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../lib/api";
import { usePartner } from "../../lib/store";
import { Badge } from "@/app/components/ui/kit";
import {
  CardSkeleton,
  Empty,
  Notice,
  PageHead,
  Panel,
  PanelHead,
  TRow,
} from "../../lib/ui";

type Account = {
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

type Payout = {
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

type Payload = {
  summary: { available: number; pending: number; paid: number; earned: number };
  payouts: Payout[];
  accounts: Account[];
  minPayout: number;
  holdDays: number;
};

const KIND_LABEL: Record<string, string> = {
  upi: "UPI",
  bank: "Bank",
  usdt: "USDT",
};

function describe(a: Account) {
  if (a.kind === "upi") return a.upiId;
  if (a.kind === "bank")
    return `${a.bankName || "Bank"} · ****${a.accountTail}${a.ifsc ? ` · ${a.ifsc}` : ""}`;
  return `${a.usdtNetwork || "TRC20"} · ${a.usdtAddress}`;
}

export default function PartnerPayouts() {
  const { me, loading, toast, patch } = usePartner();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"upi" | "bank" | "usdt">("upi");
  const [form, setForm] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    pGet<Payload>("/payouts")
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const accounts = data?.accounts || [];
  const available = data?.summary.available ?? me?.summary.available ?? 0;
  const minPayout = data?.minPayout ?? me?.affiliate.minPayout ?? 1000;
  const openRequest = useMemo(
    () =>
      (data?.payouts || []).find(
        (p) => p.status === "requested" || p.status === "approved",
      ),
    [data],
  );

  const chosen =
    accounts.find((a) => a.id === accountId) ||
    accounts.find((a) => a.isDefault) ||
    accounts[0];
  const amountNum = Number(amount) || 0;
  const canRequest =
    !busy &&
    !openRequest &&
    accounts.length > 0 &&
    amountNum >= minPayout &&
    amountNum <= available;

  async function submit() {
    if (!canRequest) return;
    setBusy(true);
    try {
      const res = await pPost<{
        payouts: Payout[];
        summary: Payload["summary"];
      }>("/payouts", {
        amount: amountNum,
        accountId: chosen?.id,
        note,
      });
      setData((d) =>
        d ? { ...d, payouts: res.payouts, summary: res.summary } : d,
      );
      patch({ available: res.summary.available });
      setAmount("");
      setNote("");
      toast("Payout requested — our finance team will process it", "ok");
    } catch (e: any) {
      toast(e?.message || "Could not request a payout", "err");
    } finally {
      setBusy(false);
    }
  }

  async function addAccount() {
    setBusy(true);
    try {
      const res = await pPost<{ accounts: Account[] }>("/accounts", {
        action: "add",
        kind,
        ...form,
      });
      setData((d) => (d ? { ...d, accounts: res.accounts } : d));
      setForm({});
      setAdding(false);
      toast("Payout destination saved", "ok");
    } catch (e: any) {
      toast(e?.message || "Could not save that destination", "err");
    } finally {
      setBusy(false);
    }
  }

  async function accountAction(action: "default" | "remove", id: string) {
    try {
      const res = await pPost<{ accounts: Account[] }>("/accounts", {
        action,
        id,
      });
      setData((d) => (d ? { ...d, accounts: res.accounts } : d));
      toast(
        action === "remove" ? "Destination removed" : "Default updated",
        "ok",
      );
    } catch (e: any) {
      toast(e?.message || "Could not update destinations", "err");
    }
  }

  if (!data && loading)
    return (
      <>
        <PageHead eyebrow="Money" title="Payouts" />
        <CardSkeleton rows={3} />
      </>
    );

  const pct = available > 0 ? Math.min(100, (amountNum / available) * 100) : 0;

  return (
    <>
      <PageHead
        eyebrow="Money"
        title="Payouts"
        subtitle="Request a withdrawal and we send it by UPI or USDT. Every payout is checked and released by our finance team."
      />

      {/* ── Request ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        <Panel className="relative">
          <div className="pointer-events-none absolute -left-12 -top-14 h-40 w-40 rounded-full bg-positive/10 blur-3xl" />
          <div className="relative p-5">
            <div className="eyebrow">Available to withdraw</div>
            <div className="display-num mt-1.5 text-[36px] font-semibold leading-none text-positive">
              {inr(available, 2)}
            </div>
            <div className="mt-2 text-[12px] text-muted-foreground">
              {inr(data?.summary.pending ?? 0)} still inside the{" "}
              {data?.holdDays ?? 0}-day holdback · minimum {inr(minPayout)}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border/60">
              {[
                { l: "Withdrawn", v: inr(data?.summary.paid ?? 0) },
                { l: "Lifetime", v: inr(data?.summary.earned ?? 0) },
                {
                  l: "Requests",
                  v: String((data?.payouts || []).length),
                },
              ].map((k) => (
                <div key={k.l} className="bg-card px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {k.l}
                  </div>
                  <div className="display-num mt-0.5 text-[13px] font-semibold text-foreground">
                    {k.v}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="Request a payout"
            hint={
              openRequest
                ? "You already have a request in progress"
                : "Sends to your default destination unless you pick another"
            }
          />
          <div className="space-y-3 p-4">
            {openRequest ? (
              <Notice tone="brand">
                Request <strong>{openRequest.id}</strong> for{" "}
                {inr(openRequest.amount)} is{" "}
                {STATUS_LABEL[openRequest.status]?.toLowerCase()}. You can
                request again once it is paid or rejected.
              </Notice>
            ) : null}

            {accounts.length === 0 ? (
              <Notice tone="warn">
                Add a payout destination first — we cannot send money without
                one. Use the form below.
              </Notice>
            ) : null}

            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Amount
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!!openRequest}
                  className="display-num h-11 w-full rounded-xl border border-border bg-background px-3 text-[14px] font-semibold text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.floor(available)))}
                  disabled={!!openRequest || available <= 0}
                  className="pressable h-11 shrink-0 rounded-xl border border-border bg-card px-3.5 text-[12px] font-semibold text-foreground disabled:opacity-50"
                >
                  Max
                </button>
              </div>
            </label>

            {amountNum > 0 ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-[width] ${
                    amountNum > available ? "bg-negative" : "brand-gradient"
                  }`}
                  style={{ width: `${amountNum > available ? 100 : pct}%` }}
                />
              </div>
            ) : null}

            {amountNum > 0 && amountNum > available ? (
              <div className="text-[11.5px] font-medium text-negative">
                That is more than your available balance of {inr(available, 2)}.
              </div>
            ) : amountNum > 0 && amountNum < minPayout ? (
              <div className="text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                Minimum payout is {inr(minPayout)}.
              </div>
            ) : null}

            {accounts.length > 0 ? (
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Send to
                </span>
                <select
                  value={chosen?.id || ""}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={!!openRequest}
                  className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {KIND_LABEL[a.kind]}
                      {a.isDefault ? " (default)" : ""} — {describe(a)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Note (optional)
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Anything our finance team should know"
                disabled={!!openRequest}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
              />
            </label>

            <button
              type="button"
              onClick={submit}
              disabled={!canRequest}
              className="pressable btn-money inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold disabled:opacity-45"
            >
              <FiCreditCard size={15} />
              {busy
                ? "Requesting…"
                : `Request ${amountNum > 0 ? inr(amountNum) : "payout"}`}
            </button>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Payouts are processed on working days. A request moves no money by
              itself — it is reviewed and sent by our team, usually within one
              working day of the holdback clearing.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── Destinations ────────────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Payout destinations"
          hint="Where we send your money"
          right={
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[11.5px] font-semibold text-foreground"
            >
              {adding ? <FiX size={13} /> : <FiPlus size={13} />}
              {adding ? "Cancel" : "Add"}
            </button>
          }
        />

        {adding ? (
          <div className="border-b border-border/60 bg-muted/25 p-4">
            <div className="mb-3 inline-flex rounded-lg border border-border bg-card p-0.5">
              {(["upi", "bank", "usdt"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setForm({});
                  }}
                  className={`pressable rounded-[7px] px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    kind === k
                      ? "brand-panel text-brand-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {kind === "upi" ? (
                <>
                  <Input
                    label="UPI ID"
                    placeholder="yourname@okhdfcbank"
                    value={form.upiId || ""}
                    onChange={(v) => setForm({ ...form, upiId: v })}
                  />
                  <Input
                    label="Account holder name"
                    placeholder="As per bank records"
                    value={form.holder || ""}
                    onChange={(v) => setForm({ ...form, holder: v })}
                  />
                </>
              ) : kind === "bank" ? (
                <>
                  <Input
                    label="Account number"
                    placeholder="Only the last 4 digits are stored"
                    value={form.accountNumber || ""}
                    onChange={(v) => setForm({ ...form, accountNumber: v })}
                  />
                  <Input
                    label="IFSC code"
                    placeholder="HDFC0001234"
                    value={form.ifsc || ""}
                    onChange={(v) =>
                      setForm({ ...form, ifsc: v.toUpperCase() })
                    }
                  />
                  <Input
                    label="Bank name"
                    placeholder="HDFC Bank"
                    value={form.bankName || ""}
                    onChange={(v) => setForm({ ...form, bankName: v })}
                  />
                  <Input
                    label="Account holder name"
                    value={form.holder || ""}
                    onChange={(v) => setForm({ ...form, holder: v })}
                  />
                </>
              ) : (
                <>
                  <Input
                    label="USDT wallet address"
                    placeholder="T… (TRC20 recommended)"
                    value={form.usdtAddress || ""}
                    onChange={(v) => setForm({ ...form, usdtAddress: v })}
                  />
                  <label className="block">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Network
                    </span>
                    <select
                      value={form.usdtNetwork || "TRC20"}
                      onChange={(e) =>
                        setForm({ ...form, usdtNetwork: e.target.value })
                      }
                      className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {["TRC20", "ERC20", "BEP20", "POLYGON"].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            {kind === "usdt" ? (
              <div className="mt-3">
                <Notice tone="warn">
                  Double-check the network. USDT sent to the wrong chain cannot
                  be recovered, by us or by anyone else. TRC20 is cheapest; make
                  sure your exchange credits the same chain.
                </Notice>
              </div>
            ) : null}

            <button
              type="button"
              onClick={addAccount}
              disabled={busy}
              className="pressable mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-[12px] font-semibold text-background disabled:opacity-50"
            >
              <FiPlus size={13} />
              Save destination
            </button>
          </div>
        ) : null}

        {accounts.length === 0 && !adding ? (
          <Empty
            icon={<FiCreditCard size={18} />}
            title="No payout destination yet"
            body="Add a UPI ID, a bank account or a USDT wallet. UPI is usually the fastest route for Indian partners."
            action={
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-[12px] font-semibold text-background"
              >
                <FiPlus size={13} />
                Add destination
              </button>
            }
          />
        ) : (
          <div className="divide-y divide-border/60">
            {accounts.map((a) => (
              <TRow key={a.id}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                  {KIND_LABEL[a.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="display-num truncate text-[12.5px] font-medium text-foreground">
                      {describe(a)}
                    </span>
                    {a.isDefault ? (
                      <Badge tone="brand">
                        <FiStar size={10} />
                        Default
                      </Badge>
                    ) : null}
                  </div>
                  {a.holder ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.holder}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyText(
                      a.kind === "upi"
                        ? a.upiId
                        : a.kind === "usdt"
                          ? a.usdtAddress
                          : a.accountTail,
                    );
                    setCopied(a.id);
                    toast(ok ? "Copied" : "Could not copy", ok ? "ok" : "err");
                    setTimeout(() => setCopied(null), 1400);
                  }}
                  className="pressable hidden h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground sm:inline-flex"
                >
                  {copied === a.id ? <FiCheck size={12} /> : "Copy"}
                </button>
                {!a.isDefault ? (
                  <button
                    type="button"
                    onClick={() => accountAction("default", a.id)}
                    className="pressable grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                    aria-label="Make default"
                  >
                    <FiStar size={13} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => accountAction("remove", a.id)}
                  className="pressable grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-negative/30 text-negative"
                  aria-label="Remove destination"
                >
                  <FiTrash2 size={13} />
                </button>
              </TRow>
            ))}
          </div>
        )}
      </Panel>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead title="Payout history" hint="Requests and their outcome" />
        {(data?.payouts || []).length === 0 ? (
          <Empty
            icon={<FiCreditCard size={18} />}
            title="No payout requests yet"
            body="Once you request a payout it appears here with its reference number and status."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {data!.payouts.map((p) => (
              <TRow key={p.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="display-num text-[12px] font-semibold text-foreground">
                      {p.id}
                    </span>
                    <Badge tone={STATUS_TONE[p.status]}>
                      {STATUS_LABEL[p.status] || p.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {shortDate(p.requestedAt)} · {p.destination}
                    {p.utr ? ` · ref ${p.utr}` : ""}
                  </div>
                  {p.status === "rejected" && p.note ? (
                    <div className="mt-1 flex items-start gap-1.5 text-[11px] text-negative">
                      <FiAlertCircle size={12} className="mt-0.5 shrink-0" />
                      {p.note}
                    </div>
                  ) : null}
                </div>
                <div
                  className={`display-num shrink-0 text-[13px] font-semibold ${
                    p.status === "rejected"
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {inr(p.amount)}
                </div>
              </TRow>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      />
    </label>
  );
}
