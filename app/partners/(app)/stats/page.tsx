"use client";

// Statistics — the report page.
//
// Three separate charts rather than one combined axis: clicks, signups and
// rupees do not share a unit, and overlaying them makes every trend unreadable.
// The range selector re-fetches from `/me?days=` so the series is computed on
// the server and the browser only draws it.

import { useEffect, useMemo, useState } from "react";
import {
  FiBarChart2,
  FiMousePointer,
  FiTrendingUp,
  FiUserPlus,
} from "react-icons/fi";
import { dayLabel, inr, num, pGet } from "../../lib/api";
import { usePartner } from "../../lib/store";
import {
  Bars,
  CardSkeleton,
  Empty,
  PageHead,
  Panel,
  PanelHead,
  Segmented,
  Stat,
  TRow,
} from "../../lib/ui";

type Point = { date: string; clicks: number; signups: number; earned: number };

type Payload = {
  series: Point[];
  summary: {
    clicks: number;
    signups: number;
    conversion: number;
    deposited: number;
    earned: number;
    pending: number;
    available: number;
  };
  recentReferrals: {
    landing: string;
    campaign: string;
    deposited: number;
    joinedAt: number;
  }[];
};

const RANGES = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
] as const;

export default function PartnerStats() {
  const { me, loading } = usePartner();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    pGet<Payload>(`/me?days=${days}`)
      .then((d) => live && setData(d))
      .catch(() => undefined)
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [days]);

  const totals = useMemo(() => {
    const s = data?.series || [];
    return {
      clicks: s.reduce((n, p) => n + p.clicks, 0),
      signups: s.reduce((n, p) => n + p.signups, 0),
      earned: s.reduce((n, p) => n + p.earned, 0),
    };
  }, [data]);

  const best = useMemo(() => {
    const s = data?.series || [];
    if (!s.length) return { clicks: 0, date: "" };
    return s.reduce(
      (a, b) => (b.clicks > a.clicks ? { clicks: b.clicks, date: b.date } : a),
      { clicks: 0, date: "" },
    );
  }, [data]);

  const sources = useMemo(() => {
    const map = new Map<
      string,
      { key: string; signups: number; deposited: number }
    >();
    for (const r of data?.recentReferrals || []) {
      const key = r.campaign || r.landing || "(direct)";
      const row = map.get(key) || { key, signups: 0, deposited: 0 };
      row.signups += 1;
      row.deposited += r.deposited;
      map.set(key, row);
    }
    return [...map.values()]
      .sort((a, b) => b.deposited - a.deposited)
      .slice(0, 8);
  }, [data]);

  if (!data && (loading || busy))
    return (
      <>
        <PageHead eyebrow="Performance" title="Statistics" />
        <CardSkeleton rows={3} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CardSkeleton rows={1} />
          <CardSkeleton rows={1} />
          <CardSkeleton rows={1} />
        </div>
      </>
    );

  const series = data?.series || [];
  const labels = series.map((p) => dayLabel(p.date));
  const s = data?.summary || me?.summary;
  const maxSource = Math.max(1, ...sources.map((x) => x.deposited));

  return (
    <>
      <PageHead
        eyebrow="Performance"
        title="Statistics"
        subtitle="Where your traffic came from, and what it turned into."
        right={
          <Segmented value={days} onChange={setDays} options={RANGES as any} />
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Clicks · ${days}D`}
          value={num(totals.clicks)}
          sub={`Best day ${num(best.clicks)}${best.date ? ` · ${dayLabel(best.date)}` : ""}`}
          icon={<FiMousePointer size={14} />}
        />
        <Stat
          label={`Signups · ${days}D`}
          value={num(totals.signups)}
          sub={`${s?.conversion ?? 0}% click-to-signup`}
          tone="brand"
          icon={<FiUserPlus size={14} />}
        />
        <Stat
          label="Deposits (lifetime)"
          value={inr(s?.deposited ?? 0)}
          sub="verified money from your customers"
          icon={<FiBarChart2 size={14} />}
        />
        <Stat
          label={`Earned · ${days}D`}
          value={inr(totals.earned)}
          sub={`${inr(s?.pending ?? 0)} still in holdback`}
          tone="positive"
          icon={<FiTrendingUp size={14} />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Clicks" hint={`Daily, last ${days} days`} />
          <div className="p-4">
            <Bars
              values={series.map((p) => p.clicks)}
              labels={labels}
              height={110}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Signups" hint="Accounts created from your links" />
          <div className="p-4">
            <Bars
              values={series.map((p) => p.signups)}
              labels={labels}
              height={110}
              tone="positive"
            />
          </div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Earnings"
          hint={`Commission credited per day, last ${days} days`}
        />
        <div className="p-4">
          <Bars
            values={series.map((p) => p.earned)}
            labels={labels}
            height={96}
            tone="positive"
            format={(v) => inr(v)}
          />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span>
              Peak day{" "}
              <span className="font-semibold text-foreground">
                {inr(Math.max(0, ...series.map((p) => p.earned)))}
              </span>
            </span>
            <span>
              Days with earnings{" "}
              <span className="font-semibold text-foreground">
                {series.filter((p) => p.earned > 0).length}
              </span>
            </span>
          </div>
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Top sources"
          hint="Grouped by campaign tag, then landing page"
        />
        {sources.length === 0 ? (
          <Empty
            icon={<FiBarChart2 size={18} />}
            title="No attributed traffic yet"
            body="Once a link with a campaign tag converts, this table shows which sources actually pay."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {sources.map((row) => (
              <TRow key={row.key}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-[10.5px] font-bold text-brand">
                  {row.key.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">
                    {row.key}
                  </div>
                  <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted">
                    <div
                      className="brand-gradient h-full rounded-full"
                      style={{ width: `${(row.deposited / maxSource) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="display-num text-[12.5px] font-semibold text-foreground">
                    {inr(row.deposited)}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {num(row.signups)} signup{row.signups === 1 ? "" : "s"}
                  </div>
                </div>
              </TRow>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
