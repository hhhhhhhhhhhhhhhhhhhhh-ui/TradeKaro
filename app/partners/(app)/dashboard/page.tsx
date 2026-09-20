"use client";

// Partner dashboard — the screen a partner opens every morning.
//
// Order is deliberate: money first (what can I withdraw), then the funnel (is my
// traffic working), then the terms (what am I actually being paid), then the
// recent activity. Nothing here needs a second click to be useful.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FiArrowUpRight,
  FiCheck,
  FiCopy,
  FiCreditCard,
  FiMousePointer,
  FiTrendingUp,
  FiUserPlus,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import {
  copyText,
  dayLabel,
  inr,
  inrCompact,
  num,
  shortDate,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../lib/api";
import { usePartner } from "../../lib/store";
import {
  Bars,
  CardSkeleton,
  Empty,
  PageHead,
  Panel,
  PanelHead,
  Stat,
  TRow,
} from "../../lib/ui";
import { Badge } from "@/app/components/ui/kit";

export default function PartnerDashboard() {
  const { me, loading, error, toast, reload } = usePartner();
  const [copied, setCopied] = useState(false);

  const month = useMemo(() => {
    const s = me?.series || [];
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return s
      .filter((p) => p.date.startsWith(key))
      .reduce(
        (acc, p) => ({
          clicks: acc.clicks + p.clicks,
          signups: acc.signups + p.signups,
          earned: acc.earned + p.earned,
        }),
        { clicks: 0, signups: 0, earned: 0 },
      );
  }, [me]);

  if (loading && !me)
    return (
      <div className="space-y-4">
        <CardSkeleton rows={2} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="broker-card h-[104px] p-4">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton mt-3 h-6 w-24 rounded" />
            </div>
          ))}
        </div>
        <CardSkeleton rows={4} />
      </div>
    );

  if (error && !me)
    return (
      <Panel>
        <Empty
          title="We could not load your panel"
          body={error}
          action={
            <button
              type="button"
              onClick={reload}
              className="pressable h-10 rounded-xl bg-foreground px-4 text-[12px] font-semibold text-background"
            >
              Try again
            </button>
          }
        />
      </Panel>
    );

  const s = me!.summary;
  const a = me!.affiliate;
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/l/start?ref=${a.code}`;
  const clicks = (me!.series || []).map((p) => p.clicks);
  const labels = (me!.series || []).map((p) => dayLabel(p.date));

  return (
    <>
      <PageHead
        eyebrow={`Welcome back${a.name ? `, ${a.name.split(" ")[0]}` : ""}`}
        title="Partner dashboard"
        subtitle="Your traffic, your customers and your earnings — live."
        right={
          <Badge tone={a.status === "approved" ? "positive" : "neutral"}>
            {a.planName} · {a.modelLabel}
          </Badge>
        }
      />

      {/* ── Money hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden broker-card p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="eyebrow">Available to withdraw</div>
            <div className="display-num mt-1.5 text-[34px] font-semibold leading-none text-foreground sm:text-[42px]">
              {inr(s.available)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {inr(s.pending)}
                </span>{" "}
                in {a.holdDays}-day holdback
              </span>
              <span className="hidden h-3 w-px bg-border sm:block" />
              <span>
                <span className="font-semibold text-positive">
                  {inr(s.paid)}
                </span>{" "}
                paid to date
              </span>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Link
              href="/partners/payouts"
              className="pressable btn-money inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-[13px] font-semibold sm:flex-none"
            >
              <FiCreditCard size={15} />
              Request payout
            </Link>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(link);
                setCopied(ok);
                if (ok) {
                  toast("Referral link copied", "ok");
                  setTimeout(() => setCopied(false), 1600);
                } else toast("Could not copy the link", "err");
              }}
              className="pressable inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-4 text-[13px] font-semibold text-foreground sm:flex-none"
            >
              {copied ? (
                <FiCheck size={15} className="text-positive" />
              ) : (
                <FiCopy size={15} />
              )}
              Copy link
            </button>
          </div>
        </div>

        <div className="relative mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
          <FiZap size={13} className="shrink-0 text-brand" />
          <code className="display-num truncate text-[11.5px] text-muted-foreground">
            {link}
          </code>
          <span className="ml-auto shrink-0 text-[11px] font-semibold text-brand">
            {a.code}
          </span>
        </div>
        {/* Available reads ₹0 while a request is in flight. Saying so here is the
            difference between "my balance vanished" and "my money is on its way". */}
        {me!.openPayout ? (
          <div className="relative mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/25 bg-brand/8 px-3.5 py-2.5">
            <FiCreditCard size={14} className="shrink-0 text-brand" />
            <span className="text-[12px] text-brand">
              <strong className="font-semibold">
                {inr(me!.openPayout.amount)}
              </strong>{" "}
              payout to {me!.openPayout.destination} —{" "}
              {me!.openPayout.status === "approved"
                ? "approved, on its way"
                : "awaiting approval"}
              .
            </span>
            <Link
              href="/partners/payouts"
              className="pressable ml-auto shrink-0 text-[11.5px] font-semibold text-brand"
            >
              Track →
            </Link>
          </div>
        ) : null}
      </section>

      {/* ── Funnel stats ────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Clicks"
          value={num(s.clicks)}
          sub={`${num(month.clicks)} this month`}
          icon={<FiMousePointer size={14} />}
        />
        <Stat
          label="Signups"
          value={num(s.signups)}
          sub={`${num(month.signups)} this month`}
          icon={<FiUserPlus size={14} />}
        />
        <Stat
          label="Conversion"
          value={`${s.conversion}%`}
          sub="clicks that became accounts"
          tone="brand"
          icon={<FiTrendingUp size={14} />}
        />
        <Stat
          label="Customer deposits"
          value={inrCompact(s.deposited)}
          sub={`${num(s.customers)} funded customers`}
          icon={<FiUsers size={14} />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Chart ─────────────────────────────────────────────────────── */}
        <Panel>
          <PanelHead
            title="Clicks · last 30 days"
            hint={`${num(s.clicks)} total · ${num(month.clicks)} in ${new Date().toLocaleDateString("en-IN", { month: "long" })}`}
            right={
              <Link
                href="/partners/stats"
                className="pressable inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand"
              >
                Full report <FiArrowUpRight size={12} />
              </Link>
            }
          />
          <div className="p-4">
            <Bars values={clicks} labels={labels} height={92} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
            {[
              {
                label: "Earned (30d)",
                v: inr(me!.series.reduce((n, p) => n + p.earned, 0)),
                tone: "text-positive",
              },
              {
                label: "Commissions",
                v: num(me!.series.filter((p) => p.earned > 0).length),
                tone: "",
              },
              { label: "Best day", v: num(Math.max(0, ...clicks)), tone: "" },
            ].map((k) => (
              <div key={k.label} className="px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {k.label}
                </div>
                <div
                  className={`display-num mt-1 text-[15px] font-semibold ${k.tone || "text-foreground"}`}
                >
                  {k.v}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── Terms ─────────────────────────────────────────────────────── */}
        <Panel>
          <PanelHead
            title="Your commission terms"
            hint={a.planName}
            right={
              <Link
                href="/partners/profile"
                className="pressable text-[11.5px] font-semibold text-brand"
              >
                Details
              </Link>
            }
          />
          <div className="divide-y divide-border/60">
            <TermRow
              label="Model"
              value={a.modelLabel}
              hint={
                a.model === "deposit"
                  ? "Paid once, on each customer's first deposit"
                  : a.model === "revshare"
                    ? "Paid on every verified deposit"
                    : "First-deposit rate plus a recurring share"
              }
            />
            {(a.model === "deposit" || a.model === "hybrid") && (
              <TermRow label="Deposit rate" value={`${a.depositRate}%`} />
            )}
            {(a.model === "revshare" || a.model === "hybrid") && (
              <TermRow label="Recurring share" value={`${a.revRate}%`} />
            )}
            <TermRow
              label="Holdback"
              value={`${a.holdDays} days`}
              hint="Time before a commission can be withdrawn"
            />
            <TermRow
              label="Minimum payout"
              value={inr(a.minPayout)}
              hint="Requests below this are not accepted"
            />
          </div>
        </Panel>
      </div>

      {/* ── Activity ────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead
            title="Latest customers"
            hint="Referred accounts and what they deposited"
            right={
              <Link
                href="/partners/referrals"
                className="pressable inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand"
              >
                All {num(s.signups)} <FiArrowUpRight size={12} />
              </Link>
            }
          />
          {me!.recentReferrals.length === 0 ? (
            <Empty
              icon={<FiUserPlus size={18} />}
              title="No customers yet"
              body="Share a landing page link — every click and signup appears here within seconds."
              action={
                <Link
                  href="/partners/links"
                  className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-[12px] font-semibold text-background"
                >
                  Get your links
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-border/60">
              {me!.recentReferrals.map((r, i) => (
                <TRow key={`${r.code}-${i}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">
                    {(r.landing || "d").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="display-num truncate text-[12.5px] font-semibold text-foreground">
                      {r.code}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {shortDate(r.joinedAt)} · {r.landing || "direct"}
                      {r.campaign ? ` · ${r.campaign}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="display-num text-[12.5px] font-semibold text-foreground">
                      {inr(r.deposited)}
                    </div>
                    <div className="text-[10.5px] text-positive">
                      {inr(r.earned)} earned
                    </div>
                  </div>
                </TRow>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHead
            title="Recent commissions"
            hint="Money credited to you"
            right={
              <Link
                href="/partners/earnings"
                className="pressable inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand"
              >
                Ledger <FiArrowUpRight size={12} />
              </Link>
            }
          />
          {me!.recentCommissions.length === 0 ? (
            <Empty
              icon={<FiTrendingUp size={18} />}
              title="No commissions yet"
              body="A commission appears the moment a customer you referred has a verified deposit."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {me!.recentCommissions.map((c) => (
                <TRow key={c.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-foreground">
                        {c.kind}
                      </span>
                      <Badge tone={STATUS_TONE[c.status]}>
                        {STATUS_LABEL[c.status] || c.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {c.customer} · {c.rate}% of {inr(c.base)} ·{" "}
                      {shortDate(c.createdAt)}
                    </div>
                  </div>
                  <div className="display-num shrink-0 text-[13px] font-semibold text-positive">
                    +{inr(c.amount)}
                  </div>
                </TRow>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function TermRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-foreground">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
      <div className="display-num shrink-0 text-[14px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}
