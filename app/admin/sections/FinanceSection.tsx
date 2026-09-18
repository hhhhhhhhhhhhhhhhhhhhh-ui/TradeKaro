"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Kpi,
  Field,
  Callout,
  EmptyState,
  TableWrap,
  thCls,
  tdCls,
  trCls,
  inputCls,
  selectCls,
  btnPrimary,
  btnGhost,
  StatusPill,
  PageHead,
} from "../_ui";

// ── Finance ─────────────────────────────────────────────────────────────────
//
// Everything about money in one place: the gateway configuration, the pay-in
// orders, the payouts, and every callback the provider sent us — including the
// ones we could not act on.
//
// The reason this is a page of its own rather than a card buried in Trading &
// Risk is that money is the one subject where "I would have to go and look" is
// the wrong answer. An operator asked "did this customer's payment land?" needs
// the order, the callback and the ledger entry on the same screen, with the
// answer readable in one glance.

type Settings = Record<string, any>;

const SUBS = [
  "Overview",
  "Settings",
  "Pay-ins",
  "Payouts",
  "Callbacks",
] as const;
type Sub = (typeof SUBS)[number];

const BAD_OUTCOMES = new Set([
  "bad_signature",
  "unknown_order",
  "unknown_payout",
  "amount_mismatch",
  "credit_refused",
]);

const FINAL_OK = new Set(["success", "credited"]);
const FINAL_BAD = new Set([
  "failed",
  "expired",
  "amount_mismatch",
  "credit_refused",
]);

function moneyFmt(n: unknown, decimals = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function when(ts: unknown) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(
    "en-IN",
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

function statusTone(s: string) {
  if (FINAL_OK.has(s)) return "text-positive";
  if (FINAL_BAD.has(s)) return "text-negative";
  return "text-muted-foreground";
}

export default function FinanceSection({
  s,
  save,
  canEdit,
  role,
}: {
  s: Settings;
  save: (patch: Settings) => Promise<void> | void;
  canEdit: boolean;
  role: string;
}) {
  const superadmin = role === "superadmin";
  const pay = (s?.payments || {}) as Record<string, any>;

  const [sub, setSub] = useState<Sub>("Overview");
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [origin, setOrigin] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  // Manual payout for a customer who asked off-platform. There is deliberately
  // NO free-text beneficiary field anywhere on this page: money may only go to
  // an account the customer themselves saved, because a beneficiary typed by an
  // operator is a typo away from a stranger's account.
  const [po, setPo] = useState({
    id: "",
    amount: "",
    accountId: "",
    accounts: [] as any[],
    withdrawable: 0,
    loaded: false,
  });
  const [rejectId, setRejectId] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/payments", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || "Could not read the payment rail");
      else {
        setErr("");
        setD(j);
      }
    } catch (e: any) {
      setErr(e?.message || "Could not read the payment rail");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  /** Patch the settings row. The server merges partial `payments` objects, so
   *  sending only what changed cannot blank a secret. */
  const savePay = async (patch: Record<string, unknown>) => {
    await save({ payments: patch });
    await load();
  };

  /** One operator action against the withdrawal queue. */
  const act = async (action: string, payload: Record<string, unknown>) => {
    setBusy(action);
    setNote("");
    try {
      const r = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      setNote(
        r.ok
          ? `${action} done`
          : // An ambiguous failure is the one an operator must not retry blindly.
            j.ambiguous
            ? `${j.error}`
            : j.error || `${action} failed`,
      );
      await load();
      return r.ok;
    } finally {
      setBusy("");
      setRejectId("");
      setRejectReason("");
    }
  };

  const field = (key: string, label: string, secret = false) => (
    <Field label={label}>
      <input
        type={secret ? "password" : "text"}
        autoComplete={secret ? "off" : undefined}
        spellCheck={false}
        disabled={!canEdit || (secret && !superadmin)}
        value={draft[key] ?? String(pay[key] ?? "")}
        placeholder={secret ? "•••• (leave blank to keep)" : undefined}
        onChange={(e) => setDraft((x) => ({ ...x, [key]: e.target.value }))}
        onBlur={async () => {
          const v = draft[key];
          setDraft((x) => {
            const { [key]: _drop, ...rest } = x;
            return rest;
          });
          if (v === undefined || v === String(pay[key] ?? "")) return;
          setBusy(key);
          await savePay({ [key]: v });
          setBusy("");
        }}
        className={inputCls}
      />
    </Field>
  );

  const numField = (key: string, label: string) => (
    <Field label={label}>
      <input
        type="number"
        min={0}
        disabled={!canEdit}
        value={draft[key] ?? String(pay[key] ?? "")}
        onChange={(e) => setDraft((x) => ({ ...x, [key]: e.target.value }))}
        onBlur={async () => {
          const v = draft[key];
          setDraft((x) => {
            const { [key]: _drop, ...rest } = x;
            return rest;
          });
          if (v === undefined || v === "") return;
          await savePay({ [key]: Number(v) });
        }}
        className={inputCls}
      />
    </Field>
  );

  const switchRow = (
    key: string,
    label: string,
    hint: string,
    disabled = false,
  ) => {
    const on = pay[key] === true;
    return (
      <button
        type="button"
        disabled={!canEdit || !superadmin || disabled}
        onClick={() => savePay({ [key]: !on })}
        className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors disabled:opacity-50 ${
          on ? "border-brand/30 bg-brand/10" : "border-border bg-card"
        }`}
      >
        <span>
          <span className="block text-[13px] font-semibold text-foreground">
            {label}
          </span>
          <span className="block text-[12px] font-normal text-muted-foreground">
            {hint}
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-muted-foreground/40"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
          />
        </span>
      </button>
    );
  };

  const st = d?.status;
  const recon = d?.recon;
  const badCallbacks = (d?.webhooks || []).filter((w: any) =>
    BAD_OUTCOMES.has(w.outcome),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Payments"
        sub="The gateway, the orders it created, the pay-outs it owes, and every callback it sent — including the ones we could not act on."
      />
      {/* Second-level tabs, deliberately quieter than the section chips in the
          header: those move you between pages, these move you within one. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
        {SUBS.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setSub(x)}
            className={`min-h-[34px] rounded-md px-3 text-[12.5px] font-semibold transition-colors ${
              sub === x
                ? "bg-brand/12 text-brand ring-1 ring-inset ring-brand/30"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {x}
            {x === "Callbacks" && badCallbacks.length ? (
              <span className="ml-1.5 rounded-full bg-negative px-1.5 text-[10.5px] text-negative-foreground">
                {badCallbacks.length}
              </span>
            ) : null}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {busy ? "saving…" : note || (err ? err : "live")}
        </span>
      </div>

      {err ? (
        <Callout tone="warn">Payment rail unreadable — {err}</Callout>
      ) : null}

      {!st ? (
        <Card title="Loading" sub="Reading the payment rail…">
          <div className="text-[13px] text-muted-foreground">…</div>
        </Card>
      ) : null}

      {st && sub === "Overview" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Gateway"
              value={st.enabled ? "Live" : "Off"}
              tone={st.enabled ? "up" : "muted"}
              sub={st.payoutsEnabled ? "pay-outs enabled" : "pay-outs off"}
            />
            <Kpi
              label="Keys"
              value={`${st.payinReady ? "in ✓" : "in —"} ${st.payoutReady ? "out ✓" : "out —"}`}
              tone={st.payinReady ? "up" : "down"}
              sub={st.payinKeyHint || "pay-in key not set"}
            />
            <Kpi
              label="Collected"
              value={moneyFmt(recon?.creditedTotal)}
              sub={`${recon?.creditedCount || 0} credited deposits`}
            />
            <Kpi
              label="Gateway balance"
              value={d?.balance ? moneyFmt(d.balance.balance) : "—"}
              tone={d?.balance ? "up" : "muted"}
              sub={
                d?.balance?.upstream_balance !== undefined
                  ? `upstream ${moneyFmt(d.balance.upstream_balance)}`
                  : d?.balanceError
                    ? "unreadable"
                    : undefined
              }
            />
          </div>

          {!st.enabled ? (
            <Callout tone="info">
              The rail is <strong>off</strong>. No gateway call is made, the
              Funds panel keeps its existing self-service funding button, and
              every <code>/api/payments</code> route refuses. Nothing changes
              for customers until you switch it on in <strong>Settings</strong>.
            </Callout>
          ) : (
            <Callout tone="warn">
              The rail is <strong>live</strong> and this platform is taking real
              money. The footer and <code>/terms</code> currently say the
              opposite — “no real funds are held or moved” — so those have to
              change, along with the regulatory question behind them.
            </Callout>
          )}

          {recon ? (
            <Card
              title="Reconciliation"
              sub="Our own order book and ledger. The gateway balance above is the figure these should agree with once settlement clears."
            >
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi
                  label="Credited in"
                  value={moneyFmt(recon.creditedTotal)}
                  sub={`${recon.creditedCount} deposits`}
                  tone="up"
                />
                <Kpi
                  label="Paid out"
                  value={moneyFmt(recon.paidOutTotal)}
                  sub={`${recon.paidOutCount} successful`}
                />
                <Kpi
                  label="Open / failed orders"
                  value={moneyFmt(recon.openTotal)}
                  sub={`${recon.openCount} orders`}
                  tone={recon.openCount ? "muted" : "up"}
                />
                <Kpi
                  label="Callbacks not actioned"
                  value={String(recon.unactionableCallbacks)}
                  tone={recon.unactionableCallbacks ? "down" : "up"}
                  sub={
                    recon.unactionableCallbacks ? "see Callbacks" : "all clean"
                  }
                />
              </div>
              {recon.unactionableCallbacks ? (
                <Callout tone="warn">
                  {recon.unactionableCallbacks} callback(s) arrived that we
                  could not act on. A rejected signature means the API secret is
                  wrong; an unknown order means the provider called about
                  something we never created. Neither moves money, which is
                  exactly why they are easy to miss — open the{" "}
                  <strong>Callbacks</strong> tab.
                </Callout>
              ) : null}
            </Card>
          ) : null}

          <Card
            title="Set-up checklist"
            sub="What has to be true before the switch means anything."
          >
            <ol className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
              <li>
                {st.payinReady ? "✓" : "1."} Paste the pay-in key and secret
                from Merchant Dashboard → API.
              </li>
              <li>
                {st.enabled ? "✓" : "2."} Turn on “Accept online payments”.
              </li>
              <li>
                3. Register both callback URLs in their dashboard — the{" "}
                <strong>Callbacks</strong> tab lists them, and the port and host
                must be publicly reachable.
              </li>
              <li>
                4. Take one small real payment and watch it appear under{" "}
                <strong>Pay-ins</strong>, then confirm the balance moved.
              </li>
              <li>
                5. Only then enable pay-outs — and only after deciding what a
                customer is allowed to withdraw.
              </li>
            </ol>
          </Card>
        </>
      ) : null}

      {st && sub === "Settings" ? (
        <>
          {!superadmin ? (
            <Callout tone="warn">
              These are superadmin settings. You can see the state but not
              change it — the server refuses either way, this just saves you the
              click.
            </Callout>
          ) : null}

          <Card
            title="Switches"
            sub="Accepting money and sending money are separate decisions."
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {switchRow(
                "enabled",
                "Accept online payments",
                "Lets a customer top up through the gateway. The ledger is credited only by a signature-verified callback.",
              )}
              {switchRow(
                "payoutsEnabled",
                "Allow pay-outs",
                "Lets an operator send money out, capped at what the customer actually funded.",
              )}
            </div>
            {!pay.payinApiKey && pay.enabled === false ? null : null}
            <Callout tone="info">
              Enabling either switch requires its key and secret to be present —
              the server refuses a half-configured rail rather than accepting
              money it cannot verify. Secrets are never returned to this page:
              you see <code>••••last4</code>, and pasting over one replaces it.
              There is deliberately no way to blank one from here.
            </Callout>
          </Card>

          <Card
            title="Limits"
            sub="Deposits and withdrawals are decided by different things, so they have separate limits."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {numField("minAmount", "Minimum deposit ₹")}
              {numField("maxAmount", "Maximum deposit ₹")}
              {numField("minWithdraw", "Minimum withdrawal ₹")}
              {numField("maxWithdraw", "Maximum withdrawal ₹")}
            </div>
            <Callout tone="info">
              The withdrawal limits apply per request, and are checked again
              server-side when the customer asks — the form cannot offer an
              amount the ledger will refuse. Anything already requested is held
              against the balance, so a customer cannot ask for the same money
              twice while a request is waiting for you.
            </Callout>
          </Card>

          <Card
            title="Credentials"
            sub="Three secrets: one per rail, plus the webhook secret the provider signs callbacks with."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {field("payinApiKey", "Pay-in API key", true)}
              {field("payinApiSecret", "Pay-in API secret", true)}
              {field("payoutApiKey", "Payout API key", true)}
              {field("payoutApiSecret", "Payout API secret", true)}
            </div>
            <Field label="Webhook secret (signs callbacks — not the pay-in secret)">
              <input
                disabled={!canEdit || !superadmin}
                value={String(draft.webhookSecret ?? pay.webhookSecret ?? "")}
                onChange={(e) =>
                  setDraft((v) => ({ ...v, webhookSecret: e.target.value }))
                }
                placeholder={
                  pay.webhookSecret
                    ? "•••• (leave blank to keep)"
                    : "From Merchant info → Webhook secret"
                }
                className={inputCls}
              />
            </Field>
            <Callout tone="info">
              This is the <strong>third</strong> secret and the only one that
              verifies an incoming callback. The merchant dashboard lists it
              under <em>Merchant info → Webhook secret</em> (“we sign callback
              POSTs to your notify URL with this secret”). Verifying with the
              pay-in secret instead rejects <strong>every</strong> callback as a
              bad signature, which looks exactly like callbacks never arriving.
              Leave it blank only if the provider issued the same value for
              both.
            </Callout>
            <Field label="API base URL">
              <input
                disabled={!canEdit || !superadmin}
                value={draft.baseUrl ?? String(pay.baseUrl ?? "")}
                onChange={(e) =>
                  setDraft((x) => ({ ...x, baseUrl: e.target.value }))
                }
                onBlur={async () => {
                  const v = draft.baseUrl;
                  setDraft((x) => {
                    const { baseUrl: _drop, ...rest } = x;
                    return rest;
                  });
                  if (v === undefined || v === String(pay.baseUrl ?? ""))
                    return;
                  await savePay({ baseUrl: v });
                }}
                className={inputCls}
              />
            </Field>
            {String(pay.baseUrl || "").includes("ttpay.business") ? null : (
              <Callout tone="warn">
                The base URL is not the provider's default. Point it at a
                sandbox only if you mean to.
              </Callout>
            )}
          </Card>
        </>
      ) : null}

      {st && sub === "Pay-ins" ? (
        <Card
          title="Pay-in orders"
          sub="Every checkout we asked the provider to create. An order only becomes money when its callback verifies."
        >
          {!(d?.orders || []).length ? (
            <EmptyState
              title="No pay-in orders yet"
              hint="They appear here the moment a customer starts a top-up."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Order</th>
                  <th className={thCls}>Account</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Method</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>UTR</th>
                  <th className={thCls}>Started</th>
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o: any) => (
                  <tr key={o.order_id} className={trCls}>
                    <td className={`${tdCls} font-mono text-[12px]`}>
                      {o.order_id}
                    </td>
                    <td className={`${tdCls} font-mono text-[12px]`}>
                      {o.user_id}
                    </td>
                    <td className={`${tdCls} font-mono`}>
                      {moneyFmt(o.amount, 2)}
                    </td>
                    <td className={tdCls}>{o.method || "—"}</td>
                    <td
                      className={`${tdCls} font-semibold ${statusTone(o.status)}`}
                    >
                      {o.status}
                    </td>
                    <td className={`${tdCls} font-mono text-[12px]`}>
                      {o.utr || "—"}
                    </td>
                    <td className={`${tdCls} text-muted-foreground`}>
                      {when(o.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      ) : null}

      {st && sub === "Payouts" ? (
        <>
          <Card
            title={`Withdrawal requests${d?.withdrawalSummary?.pendingCount ? ` (${d.withdrawalSummary.pendingCount})` : ""}`}
            sub="Oldest first. Approving sends the money to the account the customer saved — the amount and the destination cannot be edited, only approved or rejected."
          >
            {!st.payoutsEnabled ? (
              <Callout tone="warn">
                Pay-outs are switched off, so nothing can be sent. Turn on
                “Allow pay-outs” in Settings first — approving below will fail
                until you do.
              </Callout>
            ) : null}

            {!(d?.queue || []).length ? (
              <EmptyState
                title="Nothing waiting"
                hint="Requests appear here the moment a customer asks for a withdrawal."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={thCls}>Requested</th>
                    <th className={thCls}>Account</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Send to</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {d.queue.map((w: any) => (
                    <tr key={w.id} className={trCls}>
                      <td className={tdCls}>{when(w.requested_at)}</td>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {w.user_id}
                      </td>
                      <td className={`${tdCls} font-mono font-semibold`}>
                        {moneyFmt(w.amount, 2)}
                      </td>
                      <td className={`${tdCls} text-[12px]`}>
                        {w.destination}
                        {/* Paid out with the KYC gate deliberately not applied.
                            An operator should see that before approving, not
                            discover it afterwards. */}
                        {w.kycWaived ? (
                          <span
                            title={
                              w.kycMode === "inherit"
                                ? "The platform switch waives KYC for everyone — no KYC was required for this request."
                                : "This account is exempted from withdrawal KYC — no KYC was required for this request."
                            }
                            className="ml-2 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-sans text-[10px] font-bold tracking-wide text-warning"
                          >
                            KYC WAIVED
                          </span>
                        ) : null}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {rejectId === w.id ? (
                          <span className="flex flex-wrap items-center justify-end gap-2">
                            <input
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="Reason — the customer sees it"
                              className={`${inputCls} max-w-[260px]`}
                            />
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() =>
                                act("reject", {
                                  id: w.id,
                                  reason: rejectReason,
                                })
                              }
                              className={btnGhost}
                            >
                              Confirm reject
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectId("")}
                              className={btnGhost}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="flex justify-end gap-2">
                            <button
                              type="button"
                              disabled={!canEdit || !!busy}
                              onClick={() => act("approve", { id: w.id })}
                              className={btnPrimary}
                            >
                              {busy === "approve"
                                ? "Sending…"
                                : "Approve & pay"}
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit || !!busy}
                              onClick={() => setRejectId(w.id)}
                              className={btnGhost}
                            >
                              Reject
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}

            <Callout tone="info">
              Approving is the only action that moves money, and it is safe to
              click twice: the payout carries the request&apos;s own id, so a
              repeat is rejected as a duplicate rather than paid again. If the
              provider times out, the request stays approved and you are told to
              check before retrying — a timeout is not a refusal.
            </Callout>
          </Card>

          <Card
            title="Manual payout"
            sub="For a customer who asked off-platform. It still writes a withdrawal, so their balance moves either way and the books cannot drift."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Client id">
                <input
                  value={po.id}
                  onChange={(e) =>
                    setPo({
                      ...po,
                      id: e.target.value,
                      loaded: false,
                      accounts: [],
                      accountId: "",
                    })
                  }
                  placeholder="e.g. 42"
                  className={inputCls}
                />
              </Field>
              <Field label="Amount ₹">
                <input
                  type="number"
                  min={1}
                  value={po.amount}
                  onChange={(e) => setPo({ ...po, amount: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Send to">
                <select
                  value={po.accountId}
                  disabled={!po.accounts.length}
                  onChange={(e) => setPo({ ...po, accountId: e.target.value })}
                  className={`${selectCls} w-full`}
                >
                  <option value="">
                    {po.accounts.length
                      ? "Choose a saved account"
                      : "Load the client first"}
                  </option>
                  {po.accounts.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.description}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  setBusy("load");
                  try {
                    const r = await fetch(
                      `/api/admin/payments?id=${encodeURIComponent(po.id)}`,
                      { cache: "no-store" },
                    );
                    const j = await r.json().catch(() => ({}));
                    setPo((p) => ({
                      ...p,
                      accounts: j?.user?.accounts || [],
                      withdrawable: Number(j?.user?.withdrawable) || 0,
                      loaded: true,
                    }));
                  } finally {
                    setBusy("");
                  }
                }}
                disabled={!po.id || !!busy}
                className={btnGhost}
              >
                {busy === "load" ? "Loading…" : "Load accounts"}
              </button>
              {po.loaded ? (
                <span className="text-[12px] text-muted-foreground">
                  {po.accounts.length} saved account
                  {po.accounts.length === 1 ? "" : "s"} · withdrawable{" "}
                  {moneyFmt(po.withdrawable, 2)}
                </span>
              ) : null}
              <button
                type="button"
                disabled={
                  !canEdit ||
                  !st.payoutsEnabled ||
                  !!busy ||
                  !po.accountId ||
                  !(Number(po.amount) > 0)
                }
                onClick={async () => {
                  const ok = await act("manual", {
                    id: po.id,
                    amount: Number(po.amount),
                    accountId: po.accountId,
                  });
                  if (ok) setPo({ ...po, amount: "" });
                }}
                className={btnPrimary}
              >
                {busy === "manual" ? "Sending…" : "Send payout"}
              </button>
            </div>

            {po.loaded && !po.accounts.length ? (
              <Callout tone="warn">
                This customer has no saved payout account. Ask them to add one
                under Profile → Banks &amp; UPI — a payout cannot be sent
                without one, and there is deliberately no free-text beneficiary
                field here to work around that.
              </Callout>
            ) : null}
          </Card>

          <Card
            title="Payout history"
            sub="Asynchronous — the provider confirms the final state by callback."
          >
            {!(d?.payouts || []).length ? (
              <EmptyState title="No payouts yet" />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={thCls}>Payout</th>
                    <th className={thCls}>Account</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Fee</th>
                    <th className={thCls}>Net</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>UTR</th>
                    <th className={thCls}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payouts.map((p: any) => (
                    <tr key={p.payout_id} className={trCls}>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {p.payout_id}
                      </td>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {p.user_id}
                      </td>
                      <td className={`${tdCls} font-mono`}>
                        {moneyFmt(p.amount, 2)}
                      </td>
                      <td className={`${tdCls} font-mono`}>
                        {moneyFmt(p.fee, 2)}
                      </td>
                      <td className={`${tdCls} font-mono`}>
                        {moneyFmt(p.net_amount, 2)}
                      </td>
                      <td
                        className={`${tdCls} font-semibold ${statusTone(p.status)}`}
                      >
                        {p.status}
                      </td>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {p.utr || "—"}
                      </td>
                      <td className={`${tdCls} text-muted-foreground`}>
                        {p.actor || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </>
      ) : null}

      {st && sub === "Callbacks" ? (
        <>
          <Card
            title="Callback endpoints"
            sub="Paste both into the provider's dashboard. They must be publicly reachable — a callback that cannot arrive looks exactly like a customer who did not pay."
          >
            {[
              "/api/payments/webhook/payin",
              "/api/payments/webhook/payout",
            ].map((p) => (
              <div
                key={p}
                className="truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[12px]"
              >
                {origin}
                {p}
              </div>
            ))}
          </Card>

          {badCallbacks.length ? (
            <Callout tone="warn">
              <strong>
                {badCallbacks.length} callback(s) could not be acted on.
              </strong>{" "}
              {badCallbacks.map((w: any) => w.outcome).join(", ")} — a rejected
              signature means the API secret is wrong; an unknown order means
              the provider called about something we never created; the others
              mean a claim we refused. No money moved in any of these cases.
            </Callout>
          ) : null}

          <Card
            title="Delivery log"
            sub="The provider retries up to 200 times, so duplicates are normal. A replay is recorded as `duplicate` and credits nothing."
          >
            {!(d?.webhooks || []).length ? (
              <EmptyState
                title="No callbacks received"
                hint="Once the provider can reach the endpoints above they appear here."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={thCls}>When</th>
                    <th className={thCls}>Event</th>
                    <th className={thCls}>Reference</th>
                    <th className={thCls}>State</th>
                    <th className={thCls}>Signature</th>
                    <th className={thCls}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {d.webhooks.map((w: any, i: number) => (
                    <tr key={i} className={trCls}>
                      <td className={`${tdCls} text-muted-foreground`}>
                        {when(w.ts)}
                      </td>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {w.event}
                      </td>
                      <td className={`${tdCls} font-mono text-[12px]`}>
                        {w.ref_id || "—"}
                      </td>
                      <td className={tdCls}>{w.status || "—"}</td>
                      <td
                        className={`${tdCls} font-semibold ${
                          w.signature_ok ? "text-positive" : "text-negative"
                        }`}
                      >
                        {w.signature_ok ? "ok" : "rejected"}
                      </td>
                      <td
                        className={`${tdCls} font-semibold ${
                          BAD_OUTCOMES.has(w.outcome)
                            ? "text-negative"
                            : w.outcome === "credited"
                              ? "text-positive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {w.outcome}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </>
      ) : null}

      {st ? (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <StatusPill tone={st.enabled ? "ok" : "off"}>
            {st.enabled ? "RAIL LIVE" : "RAIL OFF"}
          </StatusPill>
          <span>
            Base {st.baseUrl} · min {moneyFmt(st.minAmount)} · max{" "}
            {moneyFmt(st.maxAmount)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
