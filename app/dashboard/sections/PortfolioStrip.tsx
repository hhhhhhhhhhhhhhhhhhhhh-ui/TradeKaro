"use client";
import axios from "axios";
import { getCookie } from "cookies-next";
import { useEffect, useState } from "react";
import { apiURL } from "@/app/components/apiURL";
import { NavTransition } from "@/app/components/navbar/NavTransition";

// Compact portfolio summary strip for the dashboard overview.
export default function PortfolioStrip() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({});
  const [profit, setProfit] = useState<any>({});
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const token = getCookie("token") as string | undefined;
    if (!token) {
      setLoading(false);
      return;
    }
    setLoggedIn(true);
    let cancelled = false;
    async function load() {
      try {
        const [a, p] = await Promise.all([
          axios({
            method: "post",
            url: apiURL + "/auth/getAccountDetails",
            headers: { Authorization: "Bearer " + token },
          }),
          axios({
            method: "post",
            url: apiURL + "/transaction/getAccountProfit",
            headers: { Authorization: "Bearer " + token },
          }),
        ]);
        if (!cancelled) {
          setData(a.data || {});
          setProfit(p.data || {});
        }
      } catch {
        /* strip shows fallback */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="border border-border bg-card">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 md:p-5">
              <div className="h-3 w-16 bg-foreground/10 mb-3" />
              <div className="h-6 w-24 bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Portfolio
          </div>
          <div className="text-sm mt-1 text-foreground/80">
            Log in to track net worth, P&amp;L and holdings here.
          </div>
        </div>
        <NavTransition
          href="/login"
          className="inline-flex items-center justify-center h-[34px] px-4 text-xs font-mono bg-foreground text-background border border-foreground hover:bg-foreground/90 transition shrink-0"
        >
          LOG IN
        </NavTransition>
      </div>
    );
  }

  const netWorth = (data?.spentCash ?? 0) + (profit?.overallProfit ?? 0);
  const dayPnl = profit?.todayProfit ?? profit?.dayProfit ?? 0;
  const dayPos = Number(dayPnl) >= 0;
  const overall = profit?.overallProfit ?? 0;
  const overallPos = Number(overall) >= 0;
  const holdings = Array.isArray(data?.scrips) ? data.scrips.length : 0;

  const cells = [
    {
      label: "Net worth",
      value: `₹${Number(netWorth).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: `${overallPos ? "+" : ""}${Number(overall).toFixed(2)} overall`,
      tone: overallPos ? "text-positive" : "text-negative",
    },
    {
      label: "Day P&L",
      value: `${dayPos ? "+" : ""}₹${Number(dayPnl).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
      sub: "live ticks",
      tone: dayPos ? "text-positive" : "text-negative",
    },
    {
      label: "Cash",
      value: `₹${Number(data?.remainingCash ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      sub: "available to trade",
      tone: "",
    },
    {
      label: "Holdings",
      value: String(holdings),
      sub: "scrips held",
      tone: "",
    },
  ];

  return (
    <NavTransition
      href="/portfolio"
      className="block broker-card broker-card-hover transition pressable"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
        {cells.map((c) => (
          <div key={c.label} className="p-4 md:p-5">
            <div className="eyebrow">{c.label}</div>
            <div className="display-num text-xl md:text-2xl font-semibold mt-1">
              {c.value}
            </div>
            <div className={`text-[11px] font-mono mt-0.5 ${c.tone}`}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>
    </NavTransition>
  );
}
