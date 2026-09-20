"use client";

// Referrals — the customer list.
//
// Shows the broker client code, never a name, email or phone. A partner is
// entitled to know what their traffic earned; they are not entitled to a copy of
// the customer database. The client code is what the customer themselves would
// quote in a support ticket, so it is enough to reconcile.

import { useEffect, useMemo, useState } from "react";
import { FiSearch, FiUserPlus, FiX } from "react-icons/fi";
import { inr, inrCompact, num, pGet, shortDate } from "../../lib/api";
import { usePartner } from "../../lib/store";
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

type Referral = {
  code: string;
  joinedAt: number;
  deposited: number;
  earned: number;
  pending: number;
  landing: string;
  campaign: string;
};

type Payload = {
  summary: {
    signups: number;
    deposited: number;
    earned: number;
    pending: number;
    conversion: number;
    clicks: number;
  };
  referrals: Referral[];
  campaigns: { campaign: string; signups: number; deposited: number }[];
};

type Sort = "recent" | "deposit" | "earned";

const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "deposit", label: "Deposits" },
  { value: "earned", label: "Earnings" },
] as const;

export default function PartnerReferrals() {
  const { loading } = usePartner();
  const [data, setData] = useState<Payload | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    pGet<Payload>("/referrals")
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => {
    const list = [...(data?.referrals || [])];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? list.filter(
          (r) =>
            r.code.toLowerCase().includes(needle) ||
            r.landing.toLowerCase().includes(needle) ||
            r.campaign.toLowerCase().includes(needle),
        )
      : list;
    if (sort === "deposit")
      return filtered.sort((a, b) => b.deposited - a.deposited);
    if (sort === "earned") return filtered.sort((a, b) => b.earned - a.earned);
    return filtered.sort((a, b) => b.joinedAt - a.joinedAt);
  }, [data, sort, q]);

  if (!data && loading)
    return (
      <>
        <PageHead eyebrow="Audience" title="Referrals" />
        <CardSkeleton rows={4} />
      </>
    );

  const s = data?.summary;

  return (
    <>
      <PageHead
        eyebrow="Audience"
        title="Referrals"
        subtitle="Every account your links produced, and what each one is worth to you."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Customers"
          value={num(s?.signups ?? 0)}
          sub={`${num(s?.clicks ?? 0)} clicks`}
        />
        <Stat
          label="Deposited"
          value={inrCompact(s?.deposited ?? 0)}
          sub="verified, from your traffic"
        />
        <Stat
          label="Earned"
          value={inr(s?.earned ?? 0)}
          tone="positive"
          sub={`${inr(s?.pending ?? 0)} pending`}
        />
        <Stat
          label="Conversion"
          value={`${s?.conversion ?? 0}%`}
          tone="brand"
          sub="click to signup"
        />
      </div>

      {/* ── Campaign rollup ─────────────────────────────────────────────── */}
      {data && data.campaigns.length > 0 ? (
        <Panel className="mt-4">
          <PanelHead
            title="By campaign"
            hint="Which of your campaigns actually converts"
            right={
              <span className="text-[11px] text-muted-foreground">
                {data.campaigns.length} source
                {data.campaigns.length === 1 ? "" : "s"}
              </span>
            }
          />
          <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
            {data.campaigns.slice(0, 8).map((c) => (
              <div key={c.campaign} className="bg-card p-3.5">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {c.campaign}
                </div>
                <div className="display-num mt-1 text-[15px] font-semibold text-foreground">
                  {inr(c.deposited)}
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {num(c.signups)} signup{c.signups === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* ── The list ────────────────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Customers"
          hint="One partner per customer — permanently attributed"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <FiSearch
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search code or campaign"
                  className="h-8 w-[190px] rounded-lg border border-border bg-background pl-8 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
                {q ? (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <FiX size={12} />
                  </button>
                ) : null}
              </div>
              <Segmented
                value={sort}
                onChange={setSort}
                options={SORTS as any}
              />
            </div>
          }
        />

        {!data ? (
          <div className="p-4">
            <CardSkeleton rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <Empty
            icon={<FiUserPlus size={18} />}
            title={q ? "No customer matches that search" : "No customers yet"}
            body={
              q
                ? "Try a different client code or campaign tag."
                : "Your first signup will appear here the moment someone registers through one of your links."
            }
          />
        ) : (
          <>
            {/* Desktop header */}
            <div className="hidden items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:flex">
              <span className="flex-1">Client / source</span>
              <span className="w-24 text-right">Joined</span>
              <span className="w-24 text-right">Deposited</span>
              <span className="w-20 text-right">Earned</span>
            </div>
            <div className="divide-y divide-border/60">
              {rows.map((r) => (
                <TRow key={`${r.code}-${r.joinedAt}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="display-num text-[12.5px] font-semibold text-foreground">
                        {r.code}
                      </span>
                      {r.campaign ? (
                        <span className="rounded-full border border-brand/25 bg-brand/8 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          {r.campaign}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      via {r.landing || "direct"}
                      <span className="sm:hidden">
                        {" "}
                        · {shortDate(r.joinedAt)}
                      </span>
                      {r.pending > 0 ? ` · ${inr(r.pending)} pending` : ""}
                    </div>
                  </div>
                  <div className="hidden w-24 shrink-0 text-right text-[11.5px] text-muted-foreground sm:block">
                    {shortDate(r.joinedAt)}
                  </div>
                  <div className="display-num w-24 shrink-0 text-right text-[12.5px] font-semibold text-foreground">
                    {inr(r.deposited)}
                  </div>
                  <div className="display-num w-20 shrink-0 text-right text-[12.5px] font-semibold text-positive">
                    {inr(r.earned)}
                  </div>
                </TRow>
              ))}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
