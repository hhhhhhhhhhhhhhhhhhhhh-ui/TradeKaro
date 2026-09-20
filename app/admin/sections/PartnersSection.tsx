"use client";

// Affiliate programme, operator side.
//
// Four jobs, four views — the same rule the rest of this console uses:
//
//   Applications     someone applied. Should we take them, and on what terms?
//   Affiliates       who is promoting us, what are they on, how are they doing?
//   Payout requests  partners asked for money. Pay them, or say why not.
//   Requests         partners asked us for a page or artwork. Answer them.
//
// Every write goes through /api/admin/affiliates, /api/admin/affiliate-payouts or
// /api/admin/affiliate-requests, which do the validation and the audit entry.
// Nothing here computes money: it displays what the affiliate store returns, so
// the console and the partner's own panel are reading the same arithmetic.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiAlertTriangle,
  FiArrowRight,
  FiCheck,
  FiClock,
  FiCreditCard,
  FiExternalLink,
  FiInbox,
  FiList,
  FiRefreshCw,
  FiSlash,
  FiTrendingUp,
  FiUsers,
  FiX,
} from "react-icons/fi";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  FilterBar,
  Kpi,
  PageHead,
  SearchBox,
  TableWrap,
  btnDanger,
  btnDark,
  btnGhost,
  btnPrimary,
  inputCls,
  selectCls,
  tdCls,
  thCls,
  trCls,
} from "../_ui";

// ── formatting ──────────────────────────────────────────────────────────────

const inr = (n: unknown, dp = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
const num = (n: unknown) => Number(n || 0).toLocaleString("en-IN");
const dt = (ts: unknown) =>
  ts
    ? new Date(Number(ts)).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
    : "—";

const STATUS_TONE: Record<
  string,
  "slate" | "green" | "red" | "amber" | "blue"
> = {
  pending: "amber",
  approved: "green",
  suspended: "red",
  rejected: "slate",
  requested: "amber",
  paid: "green",
  "payout-rejected": "red",
};

// ── types ───────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  model: string;
  modelLabel: string;
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
};

type Row = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  audience: string;
  status: string;
  planId: string | null;
  planName: string;
  model: string;
  modelLabel: string;
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
  note: string;
  rejectReason: string;
  createdAt: number;
  decidedAt: number | null;
  lastLogin: number | null;
  loginCount: number;
  customers: number;
  deposited: number;
  earned: number;
  pending: number;
  available: number;
  paid: number;
  clicks: number;
  awaitingPayouts: number;
  lastActivity: number | null;
};

type Overview = {
  affiliates: {
    total: number;
    pending: number;
    approved: number;
    suspended: number;
    rejected: number;
  };
  traffic: { clicks: number; signups: number; conversion: number };
  money: {
    deposited: number;
    earned: number;
    inHoldback: number;
    committed: number;
    owed: number;
    paid: number;
    awaitingCount: number;
    awaitingAmount: number;
  };
};

type PayoutRow = {
  id: string;
  amount: number;
  method: string;
  destination: string;
  status: string;
  note: string;
  utr: string;
  requestedAt: number;
  decidedAt: number | null;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  affiliateCode: string;
  affiliateStatus: string;
  affiliateAvailable: number;
};

type RequestRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  audience: string;
  status: "open" | "done" | "declined";
  note: string;
  createdAt: number;
  decidedAt: number | null;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  affiliateCode: string;
};

// ── section ─────────────────────────────────────────────────────────────────

// ── reconciliation ──────────────────────────────────────────────────────────

// The shape the engine reports. Mirrors `ReconcileReport` in app/lib/affiliates
// — duplicated rather than imported so this client bundle never pulls the DB
// module in.
type ReconcileIssue = {
  kind: string;
  affiliateId: string;
  userId: string;
  depositId: number | null;
  tag: string | null;
  expected: number | null;
  actual: number | null;
  detail: string;
};

type ReconcileReport = {
  mode: string;
  affiliatesScanned: number;
  referralsScanned: number;
  depositsScanned: number;
  missing: number;
  missingAmount: number;
  mismatched: number;
  orphaned: number;
  drifted: number;
  assumedTerms: number;
  repaired: number;
  repairedAmount: number;
  truncated: boolean;
  issues: ReconcileIssue[];
};

/** What each kind of finding means, in the operator's terms. */
const ISSUE_META: Record<
  string,
  { label: string; tone: "red" | "amber" | "slate"; blurb: string }
> = {
  missing: {
    label: "Missing commission",
    tone: "red",
    blurb: "A deposit that should have paid a partner and did not. Repairable.",
  },
  amount_mismatch: {
    label: "Amount disagrees",
    tone: "red",
    blurb:
      "The stored amount differs from the ledger. Reported only — rewriting money that may already have been paid is a human decision.",
  },
  orphan: {
    label: "No such deposit",
    tone: "amber",
    blurb:
      "This commission points at a deposit that is not in the ledger. Never deleted automatically.",
  },
  counter_drift: {
    label: "Counter drift",
    tone: "amber",
    // Deliberately does NOT claim it will be repaired. The repair is withheld
    // when the ledger also holds money under a legacy key, because the engine
    // cannot tell "cache is wrong" from "ledger is under another key" — so the
    // blurb points at the detail line instead of promising something wrong.
    blurb:
      "A partner's cached deposit total disagrees with the ledger. Read the line above: it says whether this one can be settled automatically or needs a person.",
  },
  assumed_terms: {
    label: "Assumed rate",
    tone: "amber",
    blurb:
      "No terms history for this deposit, so the CURRENT rate was assumed. Worth an eye before repairing.",
  },
  no_terms: {
    label: "No terms",
    tone: "amber",
    blurb: "No commission terms could be resolved at all for this deposit.",
  },
};

export default function PartnersSection({
  view,
  canEdit,
}: {
  view:
    | "Applications"
    | "Affiliates"
    | "Payout requests"
    | "Requests"
    | "Reconciliation";
  canEdit: boolean;
}) {
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [applied, setApplied] = useState<{
    repaired: number;
    amount: number;
  } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<PayoutRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const isPayouts = view === "Payout requests";
  const isRequests = view === "Requests";
  const isReconcile = view === "Reconciliation";

  // Applications is the directory filtered to `pending` — the same data, viewed
  // through the one filter that means "a human is needed".
  const effectiveStatus = view === "Applications" ? "pending" : statusF;

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      if (isReconcile) {
        // POST rather than GET: the report is a computation, not a resource,
        // and this run is read-only. `apply` is what changes anything, and it
        // is never sent from here.
        const r = await fetch("/api/admin/affiliate-reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apply: false }),
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok)
          throw new Error(j.error || "Could not read the commission ledger");
        setReport(j);
      } else if (isRequests) {
        const r = await fetch(
          `/api/admin/affiliate-requests?status=${statusF}`,
          {
            cache: "no-store",
          },
        );
        const j = await r.json();
        if (!r.ok)
          throw new Error(j.error || "Could not load partner requests");
        setRequests(j.requests || []);
      } else if (isPayouts) {
        const r = await fetch(
          `/api/admin/affiliate-payouts?status=${statusF}`,
          {
            cache: "no-store",
          },
        );
        const j = await r.json();
        if (!r.ok)
          throw new Error(j.error || "Could not load the payout queue");
        setQueue(j.queue || []);
        setOverview(j.overview || null);
      } else {
        const r = await fetch(
          `/api/admin/affiliates?status=${effectiveStatus}&q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not load affiliates");
        setRows(j.affiliates || []);
        setPlans(j.plans || []);
        setOverview(j.overview || null);
      }
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setBusy(false);
    }
  }, [isPayouts, isRequests, isReconcile, statusF, effectiveStatus, q]);

  /**
   * Repair, deliberately behind a confirmation.
   *
   * A repaired commission for an old deposit is already past its holdback, so
   * approving this releases real money that partners can immediately withdraw.
   * That should be a decision someone made, never a side effect of clicking a
   * tab — hence the confirm, the separate button, and the audit entry the API
   * writes.
   *
   * After applying it re-reads the dry report, so the numbers on screen are the
   * state AFTER the repair rather than the state that prompted it.
   */
  const applyReconcile = useCallback(async () => {
    if (!canEdit) return;
    const sure = window.confirm(
      "Repair the commission ledger?\n\n" +
        "This creates the commission rows the deposits say should exist. \n" +
        "A repaired row for an older deposit has already served its holdback, " +
        "so it becomes withdrawable immediately.\n\n" +
        "Amounts that disagree, and commissions pointing at a missing deposit, " +
        "are reported only and left alone.",
    );
    if (!sure) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/affiliate-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Repair failed");
      setApplied({
        repaired: Number(j.repaired) || 0,
        amount: Number(j.repairedAmount) || 0,
      });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Repair failed");
    } finally {
      setBusy(false);
    }
  }, [canEdit, load]);

  useEffect(() => {
    // Reset filters when the view changes, or the pay-out tab would inherit the
    // affiliate directory's "pending" chip and show an empty list.
    setStatusF("all");
    setQ("");
    setQDraft("");
    setOpenId(null);
    setApplied(null);
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  const m = overview?.money;
  const a = overview?.affiliates;

  const title =
    view === "Applications"
      ? "Applications"
      : view === "Affiliates"
        ? "Affiliates"
        : view === "Requests"
          ? "Partner requests"
          : view === "Reconciliation"
            ? "Ledger integrity"
            : "Payout requests";
  const sub =
    view === "Applications"
      ? "Partners waiting to be reviewed, and the terms they would be approved on."
      : view === "Affiliates"
        ? "Every partner, what they are on, and what they have actually produced."
        : view === "Requests"
          ? "Landing pages and artwork partners have asked for. A request nobody answers is worse than no form at all."
          : view === "Reconciliation"
            ? "What every partner is owed, recomputed from the deposits that actually arrived and the rates that were actually in force — then compared with the commission ledger."
            : "Requests to pay. Nothing here moves money — it records a decision you have already made elsewhere.";

  return (
    <>
      <PageHead
        title={title}
        sub={sub}
        action={
          <button onClick={load} disabled={busy} className={btnGhost}>
            <span className="inline-flex items-center gap-2">
              <FiRefreshCw size={13} className={busy ? "animate-spin" : ""} />
              REFRESH
            </span>
          </button>
        }
      />

      {err ? (
        <div className="rounded-lg border border-negative/30 bg-negative/10 px-3 py-2.5 text-[12.5px] text-negative">
          {err}
        </div>
      ) : null}

      {/* ── Headline figures ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {view === "Applications" ? (
          <>
            <Kpi
              label="Awaiting review"
              value={num(a?.pending)}
              tone={(a?.pending || 0) > 0 ? "down" : "muted"}
              sub={
                (a?.pending || 0) > 0 ? "a human is needed" : "queue is clear"
              }
              icon={<FiClock size={14} />}
            />
            <Kpi
              label="Active partners"
              value={num(a?.approved)}
              sub={`${num(a?.total)} total on the programme`}
              icon={<FiUsers size={14} />}
            />
            <Kpi
              label="Attributed deposits"
              value={inr(m?.deposited)}
              sub={`${num(overview?.traffic.clicks)} clicks · ${num(overview?.traffic.signups)} signups`}
              icon={<FiTrendingUp size={14} />}
            />
            <Kpi
              label="Owed to partners"
              value={inr(m?.owed)}
              tone={(m?.owed || 0) > 0 ? "down" : "muted"}
              sub={`${inr(m?.inHoldback)} still in holdback`}
              icon={<FiCreditCard size={14} />}
            />
          </>
        ) : view === "Affiliates" ? (
          <>
            <Kpi
              label="Partners"
              value={num(a?.total)}
              sub={`${num(a?.approved)} active`}
              icon={<FiUsers size={14} />}
            />
            <Kpi
              label="Attributed deposits"
              value={inr(m?.deposited)}
              sub={`${num(overview?.traffic.conversion)}% click-to-signup`}
              icon={<FiTrendingUp size={14} />}
            />
            <Kpi
              label="Commission earned"
              value={inr(m?.earned)}
              sub={`${inr(m?.inHoldback)} in holdback`}
              icon={<FiCreditCard size={14} />}
            />
            <Kpi
              label="Owed to partners"
              value={inr(m?.owed)}
              tone={(m?.owed || 0) > 0 ? "down" : "muted"}
              sub={`${inr(m?.paid)} already paid out`}
              icon={<FiAlertTriangle size={14} />}
            />
          </>
        ) : isRequests ? (
          <>
            <Kpi
              label="Open requests"
              value={num(requests.filter((r) => r.status === "open").length)}
              tone={
                requests.filter((r) => r.status === "open").length > 0
                  ? "down"
                  : "muted"
              }
              sub={
                requests.filter((r) => r.status === "open").length > 0
                  ? "partners are waiting on us"
                  : "nothing waiting"
              }
              icon={<FiInbox size={14} />}
            />
            <Kpi
              label="Decided"
              value={num(requests.filter((r) => r.status !== "open").length)}
              sub="answered or declined"
              icon={<FiCheck size={14} />}
            />
            <Kpi
              label="Landing pages"
              value={num(
                requests.filter((r) => r.kind === "landing_page").length,
              )}
              sub="of all requests raised"
              icon={<FiTrendingUp size={14} />}
            />
            <Kpi
              label="From partners"
              value={num(new Set(requests.map((r) => r.affiliateId)).size)}
              sub="who have asked for something"
              icon={<FiUsers size={14} />}
            />
          </>
        ) : isReconcile ? (
          <>
            <Kpi
              label="Unpaid commissions"
              value={num(report?.missing)}
              tone={(report?.missing || 0) > 0 ? "down" : "muted"}
              sub={
                (report?.missing || 0) > 0
                  ? `${inr(report?.missingAmount, 2)} owed but never written`
                  : "nothing missing"
              }
              icon={<FiAlertTriangle size={14} />}
            />
            <Kpi
              label="Disagreeing amounts"
              value={num(report?.mismatched)}
              tone={(report?.mismatched || 0) > 0 ? "down" : "muted"}
              sub="reported, never rewritten"
              icon={<FiCreditCard size={14} />}
            />
            <Kpi
              label="Orphaned rows"
              value={num(report?.orphaned)}
              tone={(report?.orphaned || 0) > 0 ? "down" : "muted"}
              sub="point at no deposit"
              icon={<FiSlash size={14} />}
            />
            <Kpi
              label="Deposits checked"
              value={num(report?.depositsScanned)}
              sub={`${num(report?.referralsScanned)} referrals · ${num(report?.affiliatesScanned)} partners`}
              icon={<FiList size={14} />}
            />
          </>
        ) : (
          <>
            <Kpi
              label="Waiting for a decision"
              value={num(m?.awaitingCount)}
              tone={(m?.awaitingCount || 0) > 0 ? "down" : "muted"}
              sub={inr(m?.awaitingAmount, 2)}
              icon={<FiClock size={14} />}
            />
            <Kpi
              label="Owed to partners"
              value={inr(m?.owed)}
              sub={`${inr(m?.inHoldback)} still in holdback`}
              icon={<FiCreditCard size={14} />}
            />
            <Kpi
              label="Paid out"
              value={inr(m?.paid)}
              sub="lifetime, all partners"
              icon={<FiTrendingUp size={14} />}
            />
            <Kpi
              label="Commission earned"
              value={inr(m?.earned)}
              sub={`${num(a?.approved)} active partners`}
              icon={<FiUsers size={14} />}
            />
          </>
        )}
      </div>

      {/* ── Applications ─────────────────────────────────────────────────── */}
      {view === "Applications" ? (
        rows.length === 0 ? (
          <Card
            title="Nothing to review"
            sub="Applications appear here the moment someone applies."
          >
            <EmptyState
              title="Queue is clear"
              hint="Every application has been decided. New ones land here automatically."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <ApplicationCard
                key={r.id}
                row={r}
                plans={plans}
                canEdit={canEdit}
                onDone={load}
                onOpen={() => setOpenId(r.id)}
              />
            ))}
          </div>
        )
      ) : null}

      {/* ── Affiliates directory ─────────────────────────────────────────── */}
      {view === "Affiliates" ? (
        <Card
          title="Partner directory"
          sub="Click a partner to see their customers, commissions and payouts."
          action={
            <span className="text-[12px] text-muted-foreground">
              {busy ? "Loading…" : `${rows.length} shown`}
            </span>
          }
        >
          <FilterBar>
            <SearchBox
              value={qDraft}
              onChange={setQDraft}
              onGo={() => setQ(qDraft)}
              placeholder="Name, email, code or company…"
            />
            <select
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
              className={selectCls}
            >
              {["all", "pending", "approved", "suspended", "rejected"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "All statuses" : s}
                  </option>
                ),
              )}
            </select>
            {q ? (
              <button
                onClick={() => {
                  setQ("");
                  setQDraft("");
                }}
                className={btnGhost}
              >
                CLEAR
              </button>
            ) : null}
          </FilterBar>

          {rows.length === 0 ? (
            <EmptyState
              title="No partners match"
              hint="Try a different status, or clear the search."
            />
          ) : (
            <TableWrap>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={thCls}>Partner</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Terms</th>
                    <th className={thCls}>Clicks</th>
                    <th className={thCls}>Customers</th>
                    <th className={thCls}>Deposits</th>
                    <th className={thCls}>Earned</th>
                    <th className={thCls}>Owed</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={trCls}>
                      <td className={tdCls}>
                        <div className="font-semibold text-foreground">
                          {r.name}
                        </div>
                        <div className="font-mono text-[11.5px] text-muted-foreground">
                          {r.code} · {r.email}
                        </div>
                      </td>
                      <td className={tdCls}>
                        <Badge tone={STATUS_TONE[r.status] || "slate"}>
                          {r.status}
                        </Badge>
                        {r.awaitingPayouts > 0 ? (
                          <div className="mt-1">
                            <Badge tone="amber">
                              {r.awaitingPayouts} payout waiting
                            </Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className={tdCls}>
                        <div className="text-[12px]">{r.modelLabel}</div>
                        <div className="font-mono text-[11.5px] text-muted-foreground">
                          {r.model === "revshare"
                            ? `${r.revRate}%`
                            : r.model === "hybrid"
                              ? `${r.depositRate}%+${r.revRate}%`
                              : `${r.depositRate}%`}{" "}
                          · {r.planName}
                        </div>
                      </td>
                      <td className={`${tdCls} font-mono tabular-nums`}>
                        {num(r.clicks)}
                      </td>
                      <td className={`${tdCls} font-mono tabular-nums`}>
                        {num(r.customers)}
                      </td>
                      <td className={`${tdCls} font-mono tabular-nums`}>
                        {inr(r.deposited)}
                      </td>
                      <td className={`${tdCls} font-mono tabular-nums`}>
                        {inr(r.earned)}
                      </td>
                      <td
                        className={`${tdCls} font-mono tabular-nums font-semibold`}
                      >
                        {inr(r.available)}
                      </td>
                      <td className={tdCls}>
                        <button
                          onClick={() => setOpenId(r.id)}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
                        >
                          Open <FiArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : null}

      {/* ── Payout requests ──────────────────────────────────────────────── */}
      {isPayouts ? (
        <Card
          title="Payout queue"
          sub="Marking a payout paid is a record of a transfer you have already made."
          action={
            <span className="text-[12px] text-muted-foreground">
              {busy ? "Loading…" : `${queue.length} shown`}
            </span>
          }
        >
          <FilterBar>
            <select
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
              className={selectCls}
            >
              {["all", "requested", "approved", "paid", "rejected"].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All payouts" : s}
                </option>
              ))}
            </select>
          </FilterBar>

          {queue.length === 0 ? (
            <EmptyState
              title="No payout requests"
              hint="Partners request payouts from their own panel; new requests appear here."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {queue.map((p) => (
                <PayoutCard
                  key={p.id}
                  p={p}
                  canEdit={canEdit}
                  onDone={load}
                  onOpenAffiliate={() => setOpenId(p.affiliateId)}
                />
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* ── Partner requests ─────────────────────────────────────────────── */}
      {isRequests ? (
        <Card
          title="Requests from partners"
          sub="Landing pages and artwork. Answering is what makes the form in their panel worth having."
          action={
            <select
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
              className={selectCls}
            >
              {["all", "open", "done", "declined"].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All requests" : s}
                </option>
              ))}
            </select>
          }
        >
          {requests.length === 0 ? (
            <EmptyState
              title="No requests"
              hint="Partners raise these from the Links page in their own panel."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {requests.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  canEdit={canEdit}
                  onDone={load}
                  onOpenAffiliate={() => setOpenId(r.affiliateId)}
                />
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* ── Ledger integrity ─────────────────────────────────────────────── */}
      {isReconcile ? (
        <Card
          title="Reconciliation"
          sub="Read-only until you repair. Nothing on this page has changed anything yet."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={load} disabled={busy} className={btnGhost}>
                <span className="inline-flex items-center gap-2">
                  <FiRefreshCw
                    size={13}
                    className={busy ? "animate-spin" : ""}
                  />
                  Re-check
                </span>
              </button>
              <button
                onClick={applyReconcile}
                disabled={busy || !canEdit || (report?.missing || 0) === 0}
                className={btnDanger}
                title={
                  !canEdit
                    ? "Your role cannot move money"
                    : (report?.missing || 0) === 0
                      ? "Nothing to repair"
                      : "Creates the missing commission rows"
                }
              >
                {busy
                  ? "Working…"
                  : `Repair ${num(report?.missing)} commission(s)`}
              </button>
            </div>
          }
        >
          {applied ? (
            <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12px] text-foreground">
              <span className="font-semibold">Last repair:</span>{" "}
              {applied.repaired} commission(s) written, worth{" "}
              {inr(applied.amount, 2)}. Those rows are marked as reconciled.
            </div>
          ) : null}

          {!report ? (
            <EmptyState title="Reading the ledger…" />
          ) : report.issues.length === 0 ? (
            <EmptyState
              title="The ledger agrees with the deposits"
              hint={`Every commission for ${num(report.depositsScanned)} deposits matches what the terms say it should be.`}
            />
          ) : (
            <>
              {(report.assumedTerms || 0) > 0 ? (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-[12px] text-foreground">
                  <FiAlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0 text-accent"
                  />
                  <span>
                    {num(report.assumedTerms)} deposit(s) predate the terms
                    history, so the <strong>current</strong> rate was assumed.
                    Check those before repairing — the rate then may not be the
                    rate now.
                  </span>
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                {report.issues.map((i, n) => (
                  <IssueRow
                    key={`${i.kind}-${i.affiliateId}-${i.depositId}-${i.tag}-${n}`}
                    i={i}
                  />
                ))}
              </div>
              {report.truncated ? (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Showing the first {report.issues.length} findings — there are
                  more. Repair, then re-check.
                </p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {openId ? (
        <AffiliateDrawer
          id={openId}
          plans={plans}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      ) : null}
    </>
  );
}

// ── reconciliation finding ──────────────────────────────────────────────────

function IssueRow({ i }: { i: ReconcileIssue }) {
  const meta =
    ISSUE_META[i.kind] ||
    ({ label: i.kind, tone: "slate" as const, blurb: "" } as const);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="font-mono text-[12px] font-semibold text-foreground">
          {i.affiliateId}
        </span>
        {i.depositId ? (
          <span className="text-[11px] text-muted-foreground">
            deposit #{i.depositId}
            {i.tag ? ` · ${i.tag}` : ""}
          </span>
        ) : null}
        {/* The amount chip only makes sense where comparing an amount IS the
            finding. A counter drift's meaningful pair (cached vs ledger) is
            already spelled out in the detail, and showing "should be ₹0.00"
            beside it reads as though the partner is owed nothing. */}
        {i.expected !== null &&
        (i.kind === "missing" || i.kind === "amount_mismatch") ? (
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
            should be{" "}
            <strong className="text-foreground">{inr(i.expected, 2)}</strong>
            {i.actual !== null && i.kind === "amount_mismatch"
              ? ` · stored ${inr(i.actual, 2)}`
              : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{i.detail}</p>
      {meta.blurb ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
          {meta.blurb}
        </p>
      ) : null}
    </div>
  );
}

// ── application card ────────────────────────────────────────────────────────

function ApplicationCard({
  row,
  plans,
  canEdit,
  onDone,
  onOpen,
}: {
  row: Row;
  plans: Plan[];
  canEdit: boolean;
  onDone: () => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("pl-std");
  const [model, setModel] = useState("");
  const [depositRate, setDepositRate] = useState("");
  const [revRate, setRevRate] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const plan = useMemo(
    () => plans.find((p) => p.id === planId) || plans[0],
    [plans, planId],
  );

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/affiliates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", id: row.id, ...payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="broker-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">
              {row.name}
            </span>
            <Badge tone="amber">
              <FiClock size={10} /> awaiting review
            </Badge>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {row.code}
            </span>
          </div>
          <div className="mt-1 text-[12.5px] text-muted-foreground">
            {row.email}
            {row.phone ? ` · ${row.phone}` : ""}
            {row.company ? ` · ${row.company}` : ""}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
            Applied {dt(row.createdAt)}
            {row.website ? ` · ${row.website}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onOpen} className={btnGhost}>
            DETAILS
          </button>
          {canEdit ? (
            <>
              <button
                onClick={() => setRejecting((v) => !v)}
                className={btnGhost}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FiSlash size={13} /> REJECT
                </span>
              </button>
              <button onClick={() => setOpen((v) => !v)} className={btnPrimary}>
                <span className="inline-flex items-center gap-1.5">
                  <FiCheck size={13} /> APPROVE…
                </span>
              </button>
            </>
          ) : (
            <span className="self-center text-[12px] text-muted-foreground">
              viewer — read only
            </span>
          )}
        </div>
      </div>

      {/* What they told us they are. An application is a judgement call, so the
          answer they gave is shown in full rather than truncated behind a click. */}
      {row.audience ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            Audience
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">
            {row.audience}
          </p>
        </div>
      ) : null}

      {rejecting ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-negative/30 bg-negative/5 p-3">
          <Field label="Reason (the applicant sees this — it is required)">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. We could not verify the channel you listed."
              className={`${inputCls} min-h-[68px] py-2`}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || reason.trim().length < 3}
              onClick={() => post({ status: "rejected", rejectReason: reason })}
              className={btnDanger}
            >
              REJECT APPLICATION
            </button>
            <button onClick={() => setRejecting(false)} className={btnGhost}>
              CANCEL
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Plan">
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className={selectCls}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.modelLabel}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commission model">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={selectCls}
              >
                <option value="">Use the plan default</option>
                <option value="deposit">Deposit %</option>
                <option value="revshare">Recurring share</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </Field>
            <Field label={`Deposit rate % (plan: ${plan?.depositRate ?? 0})`}>
              <input
                value={depositRate}
                onChange={(e) => setDepositRate(e.target.value)}
                inputMode="decimal"
                placeholder="inherit"
                className={inputCls}
              />
            </Field>
            <Field label={`Recurring rate % (plan: ${plan?.revRate ?? 0})`}>
              <input
                value={revRate}
                onChange={(e) => setRevRate(e.target.value)}
                inputMode="decimal"
                placeholder="inherit"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Internal note (not shown to the partner)">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this rate, who spoke to them…"
              className={inputCls}
            />
          </Field>

          <div className="rounded-lg border border-border bg-card p-3 text-[12px] leading-relaxed text-muted-foreground">
            <strong className="font-semibold text-foreground">
              On approval
            </strong>{" "}
            this partner gets a live panel with their links and{" "}
            {inr(plan?.minPayout ?? 0)} as the minimum payout, with{" "}
            {plan?.holdDays ?? 0} days of holdback on commission. They will be
            able to sign in immediately.
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() =>
                post({
                  status: "approved",
                  planId,
                  model: model || null,
                  depositRate: depositRate === "" ? undefined : depositRate,
                  revRate: revRate === "" ? undefined : revRate,
                  note,
                })
              }
              className={btnPrimary}
            >
              <span className="inline-flex items-center gap-2">
                <FiCheck size={14} />
                {busy ? "APPROVING…" : "APPROVE PARTNER"}
              </span>
            </button>
            <button onClick={() => setOpen(false)} className={btnGhost}>
              CANCEL
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-2 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[12px] text-negative">
          {err}
        </div>
      ) : null}
    </div>
  );
}

// ── payout card ─────────────────────────────────────────────────────────────

function PayoutCard({
  p,
  canEdit,
  onDone,
  onOpenAffiliate,
}: {
  p: PayoutRow;
  canEdit: boolean;
  onDone: () => void;
  onOpenAffiliate: () => void;
}) {
  const [mode, setMode] = useState<"none" | "paid" | "reject">("none");
  const [utr, setUtr] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const open = p.status === "requested" || p.status === "approved";

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/affiliate-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, ...payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      setMode("none");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12.5px] font-semibold text-foreground">
              {p.id}
            </span>
            <Badge tone={STATUS_TONE[p.status] || "slate"}>{p.status}</Badge>
          </div>
          <div className="mt-1 text-[13px] font-semibold text-foreground">
            {inr(p.amount, 2)}{" "}
            <span className="font-normal text-muted-foreground">
              to {p.affiliateName}
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            <button
              onClick={onOpenAffiliate}
              className="font-mono hover:underline"
            >
              {p.affiliateCode}
            </button>{" "}
            · requested {dt(p.requestedAt)} · {p.destination}
          </div>
          {/* Ageing is the one thing a queue must show and rarely does. A request
              that has sat for a week is the difference between a partner who
              waits and a partner who leaves. */}
          {open && Date.now() - p.requestedAt > 48 * 3600_000 ? (
            <div className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
              <FiAlertTriangle size={12} />
              waiting {Math.floor((Date.now() - p.requestedAt) / 86400_000)} day
              {Math.floor((Date.now() - p.requestedAt) / 86400_000) === 1
                ? ""
                : "s"}
            </div>
          ) : null}
          {p.utr ? (
            <div className="mt-1 font-mono text-[11.5px] text-positive">
              reference {p.utr}
            </div>
          ) : null}
          {p.status === "rejected" && p.note ? (
            <div className="mt-1 text-[11.5px] text-negative">
              rejected — {p.note}
            </div>
          ) : null}
        </div>

        {canEdit && open ? (
          <div className="flex flex-wrap gap-2">
            {p.status === "requested" ? (
              <button
                disabled={busy}
                onClick={() => post({ status: "approved" })}
                className={btnGhost}
              >
                APPROVE
              </button>
            ) : null}
            <button
              onClick={() => setMode(mode === "reject" ? "none" : "reject")}
              className={btnGhost}
            >
              <span className="inline-flex items-center gap-1.5">
                <FiX size={13} /> REJECT
              </span>
            </button>
            <button
              onClick={() => setMode(mode === "paid" ? "none" : "paid")}
              className={btnDark}
            >
              <span className="inline-flex items-center gap-1.5">
                <FiCreditCard size={13} /> MARK PAID
              </span>
            </button>
          </div>
        ) : !open ? (
          <span className="self-center text-[11.5px] text-muted-foreground">
            {p.status === "paid"
              ? "money sent — record is final"
              : "closed — the partner must request again"}
          </span>
        ) : (
          <span className="self-center text-[11.5px] text-muted-foreground">
            viewer — read only
          </span>
        )}
      </div>

      {mode === "paid" ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-[12px] leading-relaxed text-muted-foreground">
            Send <strong className="text-foreground">{inr(p.amount, 2)}</strong>{" "}
            to <span className="font-mono">{p.destination}</span> first, then
            record it here. Record the provider reference so this is
            reconcilable later.
          </div>
          <Field label="Reference / UTR (optional but strongly recommended)">
            <input
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="e.g. 402318765432"
              className={inputCls}
            />
          </Field>
          {!utr.trim() ? (
            <div className="flex items-start gap-2 text-[11.5px] text-accent">
              <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
              Without a reference, a partner asking &ldquo;which transfer was
              that?&rdquo; cannot be answered.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => post({ status: "paid", utr })}
              className={btnPrimary}
            >
              {busy ? "SAVING…" : "CONFIRM PAID — FINAL"}
            </button>
            <button onClick={() => setMode("none")} className={btnGhost}>
              CANCEL
            </button>
          </div>
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-negative/30 bg-negative/5 p-3">
          <Field label="Reason (the partner sees this — it is required)">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. The UPI ID was rejected by the bank — please add another destination."
              className={`${inputCls} min-h-[68px] py-2`}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || reason.trim().length < 3}
              onClick={() => post({ status: "rejected", note: reason })}
              className={btnDanger}
            >
              REJECT REQUEST
            </button>
            <button onClick={() => setMode("none")} className={btnGhost}>
              CANCEL
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-2 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[12px] text-negative">
          {err}
        </div>
      ) : null}
    </div>
  );
}

// ── partner request card ────────────────────────────────────────────────────

function RequestCard({
  r,
  canEdit,
  onDone,
  onOpenAffiliate,
}: {
  r: RequestRow;
  canEdit: boolean;
  onDone: () => void;
  onOpenAffiliate: () => void;
}) {
  const [mode, setMode] = useState<"none" | "done" | "decline">("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isOpen = r.status === "open";

  async function post(status: "done" | "declined") {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/affiliate-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, status, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not save");
      setMode("none");
      setNote("");
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const kindLabel =
    r.kind === "landing_page"
      ? "Landing page"
      : r.kind === "creative"
        ? "Artwork"
        : "Other";

  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-foreground">
              {r.id}
            </span>
            <Badge
              tone={
                r.status === "done"
                  ? "green"
                  : r.status === "declined"
                    ? "red"
                    : "amber"
              }
            >
              {r.status}
            </Badge>
            <Badge tone="slate">{kindLabel}</Badge>
          </div>
          <div className="mt-1.5 text-[13px] font-semibold text-foreground">
            {r.title}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            <button
              onClick={onOpenAffiliate}
              className="font-mono hover:underline"
            >
              {r.affiliateCode}
            </button>{" "}
            · {r.affiliateName} · asked {dt(r.createdAt)}
          </div>
          {r.audience ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground/80">
                Audience:
              </span>{" "}
              {r.audience}
            </p>
          ) : null}
          {r.detail ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {r.detail}
            </p>
          ) : null}
          {r.note ? (
            <p
              className={`mt-1.5 text-[11.5px] leading-relaxed ${
                r.status === "declined" ? "text-negative" : "text-positive"
              }`}
            >
              {r.status === "declined" ? "declined — " : "reply — "}
              {r.note}
            </p>
          ) : null}
        </div>

        {canEdit && isOpen ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMode(mode === "decline" ? "none" : "decline")}
              className={btnGhost}
            >
              DECLINE
            </button>
            <button
              onClick={() => setMode(mode === "done" ? "none" : "done")}
              className={btnPrimary}
            >
              <span className="inline-flex items-center gap-1.5">
                <FiCheck size={13} /> DONE
              </span>
            </button>
          </div>
        ) : !isOpen ? (
          <span className="self-center text-[11.5px] text-muted-foreground">
            decided {dt(r.decidedAt)}
          </span>
        ) : (
          <span className="self-center text-[11.5px] text-muted-foreground">
            viewer — read only
          </span>
        )}
      </div>

      {mode !== "none" ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/25 p-3">
          <Field
            label={
              mode === "decline"
                ? "Reason (the partner sees this — it is required)"
                : "Reply (optional, shown to the partner)"
            }
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={
                mode === "decline"
                  ? "e.g. This audience is already covered by /l/options — try a different angle."
                  : "e.g. Published as /l/hindi-beginners — it is in your Links page now."
              }
              className={`${inputCls} min-h-[68px] py-2`}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || (mode === "decline" && note.trim().length < 3)}
              onClick={() => post(mode === "decline" ? "declined" : "done")}
              className={mode === "decline" ? btnDanger : btnPrimary}
            >
              {busy
                ? "SAVING…"
                : mode === "decline"
                  ? "DECLINE REQUEST"
                  : "MARK AS DONE"}
            </button>
            <button onClick={() => setMode("none")} className={btnGhost}>
              CANCEL
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-2 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-[12px] text-negative">
          {err}
        </div>
      ) : null}
    </div>
  );
}

// ── affiliate drawer ────────────────────────────────────────────────────────

type Detail = {
  affiliate: Row & {
    decidedAt: number | null;
    lastLogin: number | null;
    loginCount: number;
  };
  summary: {
    clicks: number;
    signups: number;
    conversion: number;
    deposited: number;
    earned: number;
    pending: number;
    available: number;
    paid: number;
    reversed: number;
  };
  series: { date: string; clicks: number; signups: number; earned: number }[];
  referrals: {
    code: string;
    joinedAt: number;
    deposited: number;
    earned: number;
    pending: number;
    landing: string;
    campaign: string;
  }[];
  commissions: {
    id: number;
    kind: string;
    amount: number;
    base: number;
    rate: number;
    status: string;
    createdAt: number;
    releaseAt: number | null;
    customer: string;
  }[];
  payouts: {
    id: string;
    amount: number;
    method: string;
    destination: string;
    status: string;
    note: string;
    utr: string;
    requestedAt: number;
  }[];
  accounts: {
    id: string;
    kind: string;
    upiId: string;
    accountTail: string;
    ifsc: string;
    bankName: string;
    usdtAddress: string;
    usdtNetwork: string;
    isDefault: boolean;
    holder: string;
  }[];
  campaigns: { campaign: string; signups: number; deposited: number }[];
};

function AffiliateDrawer({
  id,
  plans,
  canEdit,
  onClose,
  onChanged,
}: {
  id: string;
  plans: Plan[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"terms" | "customers" | "money">("terms");
  const [planId, setPlanId] = useState("");
  const [model, setModel] = useState("");
  const [depositRate, setDepositRate] = useState("");
  const [revRate, setRevRate] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(
        `/api/admin/affiliates?id=${encodeURIComponent(id)}`,
        {
          cache: "no-store",
        },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load this partner");
      setD(j);
      setPlanId(j.affiliate.planId || "pl-std");
      setModel(j.affiliate.model || "");
      setDepositRate("");
      setRevRate("");
      setNote(j.affiliate.note || "");
      if (!plans.length && Array.isArray(j.plans)) {
        /* plans arrive with the list; nothing to do if the list has not loaded */
      }
    } catch (e: any) {
      setErr(e?.message || "Could not load this partner");
    } finally {
      setBusy(false);
    }
  }, [id, plans.length]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function post(payload: Record<string, unknown>) {
    setErr("");
    try {
      const r = await fetch("/api/admin/affiliates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", id, ...payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      setRejecting(false);
      setReason("");
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    }
  }

  const aff = d?.affiliate;
  const s = d?.summary;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      <div className="relative flex h-full w-full max-w-[640px] flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-foreground">
                {aff?.name || "Loading…"}
              </span>
              {aff ? (
                <Badge tone={STATUS_TONE[aff.status] || "slate"}>
                  {aff.status}
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
              {aff?.code} · {aff?.email}
            </div>
          </div>
          <button onClick={onClose} className={btnGhost} aria-label="Close">
            <FiX size={14} />
          </button>
        </div>

        {err ? (
          <div className="border-b border-negative/30 bg-negative/10 px-4 py-2 text-[12.5px] text-negative">
            {err}
          </div>
        ) : null}

        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(["terms", "customers", "money"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                tab === k
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {k === "money" ? "Earnings & payouts" : k}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {busy && !d ? (
            <div className="py-10 text-center text-[12.5px] text-muted-foreground">
              Loading…
            </div>
          ) : null}

          {/* ── Terms & status ─────────────────────────────────────────── */}
          {d && tab === "terms" ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Clicks" value={num(s?.clicks)} />
                <Mini label="Customers" value={num(s?.signups)} />
                <Mini label="Deposits" value={inr(s?.deposited)} />
                <Mini label="Owed" value={inr(s?.available)} />
              </div>

              <div className="rounded-lg border border-border bg-muted/25 p-3">
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  <Dl k="Company" v={aff?.company || "—"} />
                  <Dl k="Phone" v={aff?.phone || "—"} />
                  <Dl k="Website" v={aff?.website || "—"} />
                  <Dl k="Applied" v={dt(aff?.createdAt)} />
                  <Dl k="Decided" v={dt(aff?.decidedAt)} />
                  <Dl
                    k="Sign-ins"
                    v={`${num(aff?.loginCount)}${aff?.lastLogin ? ` · last ${dt(aff.lastLogin)}` : ""}`}
                  />
                </dl>
                {aff?.audience ? (
                  <p className="mt-2.5 border-t border-border/60 pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
                    {aff.audience}
                  </p>
                ) : null}
              </div>

              {/* Status transitions */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Standing
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {aff?.status !== "approved" ? (
                    <button
                      disabled={!canEdit}
                      onClick={() => post({ status: "approved", planId })}
                      className={btnPrimary}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <FiCheck size={13} />
                        {aff?.status === "suspended" ? "REINSTATE" : "APPROVE"}
                      </span>
                    </button>
                  ) : null}
                  {aff?.status === "approved" ? (
                    <button
                      disabled={!canEdit}
                      onClick={() => post({ status: "suspended" })}
                      className={btnGhost}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <FiSlash size={13} /> SUSPEND
                      </span>
                    </button>
                  ) : null}
                  <button
                    disabled={!canEdit}
                    onClick={() => setRejecting((v) => !v)}
                    className={btnGhost}
                  >
                    REJECT…
                  </button>
                </div>
                {aff?.status === "suspended" ? (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                    A suspended partner keeps their history and their code, but
                    cannot sign in and their links stop attributing. Reinstate
                    to restore access.
                  </p>
                ) : null}
                {aff?.status === "rejected" && aff?.rejectReason ? (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-negative">
                    Rejected — {aff.rejectReason}
                  </p>
                ) : null}
              </div>

              {rejecting ? (
                <div className="flex flex-col gap-2 rounded-lg border border-negative/30 bg-negative/5 p-3">
                  <Field label="Reason (shown to the applicant)">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className={`${inputCls} min-h-[68px] py-2`}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <button
                      disabled={!canEdit || reason.trim().length < 3}
                      onClick={() =>
                        post({ status: "rejected", rejectReason: reason })
                      }
                      className={btnDanger}
                    >
                      REJECT
                    </button>
                    <button
                      onClick={() => setRejecting(false)}
                      className={btnGhost}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Terms */}
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Commercial terms
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Effective now. A rate change never rewrites commission that
                    was already earned — it applies to deposits from this point.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Plan">
                    <select
                      value={planId}
                      disabled={!canEdit}
                      onChange={(e) => setPlanId(e.target.value)}
                      className={selectCls}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.modelLabel} · {p.holdDays}d hold
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Commission model">
                    <select
                      value={model}
                      disabled={!canEdit}
                      onChange={(e) => setModel(e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Use the plan default</option>
                      <option value="deposit">Deposit %</option>
                      <option value="revshare">Recurring share</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </Field>
                  <Field
                    label={`Deposit rate % (now ${aff?.depositRate ?? 0})`}
                  >
                    <input
                      value={depositRate}
                      disabled={!canEdit}
                      onChange={(e) => setDepositRate(e.target.value)}
                      inputMode="decimal"
                      placeholder="leave blank to keep"
                      className={inputCls}
                    />
                  </Field>
                  <Field label={`Recurring rate % (now ${aff?.revRate ?? 0})`}>
                    <input
                      value={revRate}
                      disabled={!canEdit}
                      onChange={(e) => setRevRate(e.target.value)}
                      inputMode="decimal"
                      placeholder="leave blank to keep"
                      className={inputCls}
                    />
                  </Field>
                </div>
                <Field label="Internal note (not shown to the partner)">
                  <input
                    value={note}
                    disabled={!canEdit}
                    onChange={(e) => setNote(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={!canEdit}
                    onClick={() =>
                      post({
                        planId,
                        model: model || null,
                        depositRate:
                          depositRate === "" ? undefined : depositRate,
                        revRate: revRate === "" ? undefined : revRate,
                        note,
                      })
                    }
                    className={btnPrimary}
                  >
                    SAVE TERMS
                  </button>
                  {/* Overrides can be SET from this form but not unset by it —
                      blank means "leave alone", which is the safe default. This
                      is the only way back to the plan's own rates, and without it
                      an override could never be removed. */}
                  <button
                    disabled={!canEdit}
                    onClick={() =>
                      post({ planId, depositRate: null, revRate: null })
                    }
                    className={btnGhost}
                    title="Remove this partner's rate overrides and use the plan's rates"
                  >
                    RESET RATES TO PLAN
                  </button>
                  {!canEdit ? (
                    <span className="self-center text-[12px] text-muted-foreground">
                      viewer — read only
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* ── Customers ──────────────────────────────────────────────── */}
          {d && tab === "customers" ? (
            <div className="flex flex-col gap-4">
              {d.campaigns.length ? (
                <div className="rounded-lg border border-border bg-muted/25 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    By campaign
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {d.campaigns.map((c) => (
                      <div
                        key={c.campaign}
                        className="flex items-center justify-between gap-3 text-[12.5px]"
                      >
                        <span className="truncate text-foreground/85">
                          {c.campaign}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {num(c.signups)} · {inr(c.deposited)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {d.referrals.length === 0 ? (
                <EmptyState
                  title="No customers yet"
                  hint="Nobody has signed up through this partner's links."
                />
              ) : (
                <TableWrap>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={thCls}>Client</th>
                        <th className={thCls}>Joined</th>
                        <th className={thCls}>Source</th>
                        <th className={thCls}>Deposited</th>
                        <th className={thCls}>Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.referrals.map((r) => (
                        <tr key={`${r.code}-${r.joinedAt}`} className={trCls}>
                          <td className={`${tdCls} font-mono`}>{r.code}</td>
                          <td className={tdCls}>{dt(r.joinedAt)}</td>
                          <td className={tdCls}>
                            {r.campaign || r.landing || "direct"}
                          </td>
                          <td className={`${tdCls} font-mono tabular-nums`}>
                            {inr(r.deposited)}
                          </td>
                          <td className={`${tdCls} font-mono tabular-nums`}>
                            {inr(r.earned)}
                            {r.pending > 0 ? (
                              <span className="ml-1 text-[11px] text-muted-foreground">
                                ({inr(r.pending)} held)
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </div>
          ) : null}

          {/* ── Earnings & payouts ─────────────────────────────────────── */}
          {d && tab === "money" ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Earned" value={inr(s?.earned)} />
                <Mini label="In holdback" value={inr(s?.pending)} />
                <Mini label="Owed now" value={inr(s?.available)} />
                <Mini label="Paid" value={inr(s?.paid)} />
              </div>

              <div className="rounded-lg border border-border bg-muted/25 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payout destinations on file
                </div>
                {d.accounts.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    None added yet.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {d.accounts.map((a) => (
                      <div
                        key={a.id}
                        className="font-mono text-[12px] text-foreground/85"
                      >
                        {a.kind === "upi"
                          ? `UPI · ${a.upiId}`
                          : a.kind === "bank"
                            ? `BANK · ****${a.accountTail} · ${a.ifsc}`
                            : `USDT · ${a.usdtNetwork} · ${a.usdtAddress}`}
                        {a.isDefault ? (
                          <span className="ml-2 font-sans text-[11px] text-muted-foreground">
                            default
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Commission ledger ({d.commissions.length})
                </div>
                <TableWrap>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={thCls}>When</th>
                        <th className={thCls}>Client</th>
                        <th className={thCls}>Type</th>
                        <th className={thCls}>Working</th>
                        <th className={thCls}>Amount</th>
                        <th className={thCls}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.commissions.slice(0, 60).map((c) => (
                        <tr key={c.id} className={trCls}>
                          <td className={tdCls}>{dt(c.createdAt)}</td>
                          <td className={`${tdCls} font-mono`}>{c.customer}</td>
                          <td className={tdCls}>{c.kind}</td>
                          <td className={`${tdCls} font-mono text-[11.5px]`}>
                            {c.rate}% × {inr(c.base)}
                          </td>
                          <td className={`${tdCls} font-mono tabular-nums`}>
                            {inr(c.amount, 2)}
                          </td>
                          <td className={tdCls}>
                            <Badge
                              tone={
                                c.status === "pending"
                                  ? "amber"
                                  : c.status === "reversed"
                                    ? "red"
                                    : "green"
                              }
                            >
                              {/* One word, so it does not wrap in a six-column
                                  table inside a drawer. */}
                              {c.status === "pending" ? "holdback" : c.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payouts ({d.payouts.length})
                </div>
                {d.payouts.length === 0 ? (
                  <EmptyState title="No payouts yet" />
                ) : (
                  <TableWrap>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className={thCls}>Reference</th>
                          <th className={thCls}>Requested</th>
                          <th className={thCls}>Amount</th>
                          <th className={thCls}>Status</th>
                          <th className={thCls}>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.payouts.map((p) => (
                          <tr key={p.id} className={trCls}>
                            <td className={`${tdCls} font-mono`}>{p.id}</td>
                            <td className={tdCls}>{dt(p.requestedAt)}</td>
                            <td className={`${tdCls} font-mono tabular-nums`}>
                              {inr(p.amount, 2)}
                            </td>
                            <td className={tdCls}>
                              <Badge tone={STATUS_TONE[p.status] || "slate"}>
                                {p.status}
                              </Badge>
                              {p.utr ? (
                                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {p.utr}
                                </div>
                              ) : null}
                            </td>
                            <td className={`${tdCls} text-[11.5px]`}>
                              {p.note || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </div>

              <a
                href={`/partners/login`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 self-start text-[12px] font-semibold text-brand hover:underline"
              >
                <FiExternalLink size={12} />
                Open the partner sign-in page
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function Dl({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11.5px] text-muted-foreground">{k}</dt>
      <dd className="truncate text-[12.5px] text-foreground/85">{v}</dd>
    </div>
  );
}
