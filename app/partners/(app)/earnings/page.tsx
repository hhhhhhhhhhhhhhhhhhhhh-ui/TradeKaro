"use client";

// Earnings — the commission ledger.
//
// Every row can be explained in one line: what kind of commission, on what base,
// at what rate, and when it becomes withdrawable. A partner who cannot check the
// arithmetic does not trust the number, so the working is shown rather than
// summarised away.

import { useEffect, useMemo, useState } from "react";
import { FiDownload, FiPieChart, FiTrendingUp } from "react-icons/fi";
import {
  COMMISSION_LABEL,
  COMMISSION_TONE,
  inr,
  pGet,
  shortDate,
  holdLabel,
} from "../../lib/api";
import { usePartner } from "../../lib/store";
import { Badge } from "@/app/components/ui/kit";
import {
  CardSkeleton,
  Empty,
  PageHead,
  Panel,
  PanelHead,
  Segmented,
  Stat,
  TRow,
} from "../../lib/ui";

type Commission = {
  id: number;
  kind: string;
  amount: number;
  base: number;
  rate: number;
  status: "pending" | "approved" | "paid" | "reversed";
  createdAt: number;
  releaseAt: number | null;
  customer: string;
};

type Payload = {
  summary: {
    clicks: number;
    signups: number;
    deposited: number;
    earned: number;
    pending: number;
    available: number;
    paid: number;
    reversed: number;
  };
  commissions: Commission[];
  terms: {
    model: string;
    depositRate: number;
    revRate: number;
    holdDays: number;
    minPayout: number;
    planName: string;
  };
};

type Filter = "all" | "pending" | "approved";

// Three tabs, and each one can actually contain a row.
//
// No "Paid": a commission is never marked paid — the payout that carried it is,
// and that is shown on the payouts screen.
//
// No "Reversed": nothing in this system reverses a commission, so offering the
// tab showed a partner a filter that could never match anything, next to copy
// explaining what a reversal means. A view that promises a state the product
// cannot reach is worse than no view at all — it reads as a broken feature.
const FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Holdback" },
  { value: "approved", label: "Released" },
] as const;

export default function PartnerEarnings() {
  const { loading, toast } = usePartner();
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let live = true;
    pGet<Payload>("/earnings")
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => {
    const list = data?.commissions || [];
    return filter === "all" ? list : list.filter((c) => c.status === filter);
  }, [data, filter]);

  function exportCsv() {
    const list = data?.commissions || [];
    if (!list.length) return toast("Nothing to export yet", "err");
    const head = [
      "Date",
      "Customer",
      "Type",
      "Base",
      "Rate %",
      "Amount",
      "Status",
      "Releases",
    ];
    const body = list.map((c) => [
      new Date(c.createdAt).toISOString().slice(0, 10),
      c.customer,
      c.kind,
      c.base,
      c.rate,
      c.amount,
      COMMISSION_LABEL[c.status] || c.status,
      c.status === "pending" ? holdLabel(c.releaseAt) : "—",
    ]);
    // Quoted, because a client code or campaign could contain a comma and Excel
    // would silently shift every later column if it did.
    const csv = [head, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradestox-commissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Statement downloaded", "ok");
  }

  if (!data && loading)
    return (
      <>
        <PageHead eyebrow="Money" title="Earnings" />
        <CardSkeleton rows={4} />
      </>
    );

  const s = data?.summary;
  const t = data?.terms;

  return (
    <>
      <PageHead
        eyebrow="Money"
        title="Earnings"
        subtitle="Every commission we have credited to you, and exactly how it was worked out."
        right={
          <button
            type="button"
            onClick={exportCsv}
            className="pressable inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-[12px] font-semibold text-foreground"
          >
            <FiDownload size={14} />
            Statement (CSV)
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Ready to withdraw"
          value={inr(s?.available ?? 0)}
          tone="positive"
          sub="released and unrequested"
        />
        <Stat
          label="In holdback"
          value={inr(s?.pending ?? 0)}
          sub={`released after ${t?.holdDays ?? 0} days`}
        />
        <Stat
          label="Paid to date"
          value={inr(s?.paid ?? 0)}
          sub="sent to your account"
        />
        <Stat
          label="Lifetime earned"
          value={inr(s?.earned ?? 0)}
          tone="brand"
          sub={`includes ${inr(s?.pending ?? 0)} still in holdback`}
        />
      </div>

      {/* ── Terms, spelled out ──────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="How your commission is calculated"
          hint={`${t?.planName || "Standard"} plan`}
          right={
            <Badge tone="brand">
              <FiPieChart size={11} />
              {(s?.deposited ?? 0) > 0
                ? `${Math.round(((s?.earned ?? 0) / (s?.deposited ?? 1)) * 1000) / 10}% of deposits`
                : "awaiting deposits"}
            </Badge>
          }
        />
        <div className="grid gap-px bg-border/60 sm:grid-cols-3">
          <Term
            title={
              t?.model === "deposit"
                ? "Deposit percentage"
                : t?.model === "revshare"
                  ? "Recurring share"
                  : "Hybrid"
            }
            value={
              t?.model === "deposit"
                ? `${t.depositRate}%`
                : t?.model === "revshare"
                  ? `${t.revRate}%`
                  : `${t?.depositRate ?? 0}% + ${t?.revRate ?? 0}%`
            }
            body={
              t?.model === "deposit"
                ? "A one-off cut of each customer's first verified deposit."
                : t?.model === "revshare"
                  ? "A cut of every verified deposit your customers make, for as long as they keep depositing."
                  : "A one-off cut of the first deposit, plus a recurring share of every verified deposit after it."
            }
          />
          <Term
            title="Holdback"
            value={`${t?.holdDays ?? 0} days`}
            body="Commission cannot be withdrawn until this window has passed. It delays payment, so a deposit that is returned shortly after it arrives is seen before any commission goes out."
          />
          <Term
            title="Minimum payout"
            value={inr(t?.minPayout ?? 0)}
            body="Requests below the minimum are rejected automatically, so small balances are not lost to transfer costs."
          />
        </div>
      </Panel>

      {/* ── Ledger ──────────────────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Commission ledger"
          hint={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
          right={
            <Segmented
              value={filter}
              onChange={setFilter}
              options={FILTERS as any}
            />
          }
        />

        {rows.length === 0 ? (
          <Empty
            icon={<FiTrendingUp size={18} />}
            title={
              filter === "all"
                ? "No commissions yet"
                : `Nothing marked "${FILTERS.find((f) => f.value === filter)?.label}"`
            }
            body={
              filter === "all"
                ? "Commission is credited automatically the moment a referred customer has a verified deposit."
                : "Try another filter to see the rest of your ledger."
            }
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:flex">
              <span className="flex-1">Commission</span>
              <span className="w-28 text-right">Working</span>
              <span className="w-24 text-right">Status</span>
              <span className="w-24 text-right">Amount</span>
            </div>
            <div className="divide-y divide-border/60">
              {rows.map((c) => (
                <TRow key={c.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-foreground">
                        {c.kind}
                      </span>
                      {c.status === "pending" ? (
                        <span className="text-[10.5px] text-muted-foreground">
                          releases {holdLabel(c.releaseAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      <span className="display-num">{c.customer}</span> ·{" "}
                      {shortDate(c.createdAt)}
                      <span className="sm:hidden">
                        {" "}
                        · {c.rate}% of {inr(c.base)}
                      </span>
                    </div>
                  </div>
                  <div className="display-num hidden w-28 shrink-0 text-right text-[11.5px] text-muted-foreground sm:block">
                    {c.rate}% × {inr(c.base)}
                  </div>
                  <div className="hidden w-24 shrink-0 justify-end sm:flex">
                    <Badge tone={COMMISSION_TONE[c.status]}>
                      {COMMISSION_LABEL[c.status] || c.status}
                    </Badge>
                  </div>
                  <div
                    className={`display-num w-24 shrink-0 text-right text-[12.5px] font-semibold ${
                      c.status === "reversed"
                        ? "text-negative line-through"
                        : "text-positive"
                    }`}
                  >
                    {c.status === "reversed" ? "−" : "+"}
                    {inr(c.amount)}
                  </div>
                </TRow>
              ))}
            </div>
          </>
        )}
      </Panel>

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
        Gateway and processing fees are absorbed by us and are never deducted
        from a commission. Your percentage applies to the full verified deposit.
      </p>
    </>
  );
}

function Term({
  title,
  value,
  body,
}: {
  title: string;
  value: string;
  body: string;
}) {
  return (
    <div className="bg-card p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="display-num mt-1 text-[19px] font-semibold text-foreground">
        {value}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
