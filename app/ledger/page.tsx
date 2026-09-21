"use client";
import axios from "axios";
import { getCookie } from "cookies-next";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiURL } from "@/app/components/apiURL";
import Loading from "@/app/components/Loading";
import { getTrades } from "@/app/lib/trading";
import { sileo } from "sileo";

type Row = {
  id: string;
  at: number;
  label: string;
  kind: "CREDIT" | "DEBIT";
  amount: number;
  src: "fund" | "trade" | "broker";
};

export default function LedgerPage() {
  const [loading, setLoading] = useState(true);
  const [fundTxs, setFundTxs] = useState<any[]>([]);
  const [brokerOrders, setBrokerOrders] = useState<any[]>([]);
  const [paperTrades, setPaperTrades] = useState<any[]>([]);

  useEffect(() => {
    // Deposits live in the server ledger (POST /api/trade/deposit). The old
    // localStorage `fs_funds` list is gone, so this page reads the real one.
    (async () => {
      try {
        const r = await fetch("/api/trade/deposit", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        setFundTxs(Array.isArray(j?.deposits) ? j.deposits : []);
      } catch {
        setFundTxs([]);
      }
    })();
    try {
      setPaperTrades(getTrades());
    } catch {
      setPaperTrades([]);
    }
    const token = getCookie("token") as string | undefined;
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await axios({
          method: "post",
          url: apiURL + "/auth/getAccountDetails",
          headers: { Authorization: "Bearer " + token },
        });
        if (!cancelled) setBrokerOrders(r.data?.orderBook || []);
      } catch {
        /* offline — local ledger still shows */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const t of fundTxs) {
      out.push({
        id: `fund-${t.id}`,
        at: Number(t.ts) || 0,
        label: t.method === "admin" ? "Deposit credited" : "Funds deposited",
        kind: "CREDIT",
        amount: Number(t.amount) || 0,
        src: "fund",
      });
    }
    for (const t of paperTrades) {
      out.push({
        id: `paper-${t.id}`,
        at: t.at,
        label: `Paper ${t.side} ${t.qty} ${t.scrip} @ ₹${Number(t.price).toFixed(2)}`,
        kind: t.side === "SELL" ? "CREDIT" : "DEBIT",
        amount: Number(t.value) || 0,
        src: "trade",
      });
    }
    for (const o of brokerOrders) {
      const isBuy = String(o.type).toUpperCase() === "BUY";
      out.push({
        id: `broker-${o.scrip}-${o.time}-${o.price}-${o.quantity}`,
        at: Date.parse(`${o.date || ""} ${o.time || ""}`) || Date.now(),
        label: `Broker ${o.type} ${o.quantity} ${o.scrip} @ ₹${Number(o.price).toFixed(2)}`,
        kind: isBuy ? "DEBIT" : "CREDIT",
        amount: Number(o.price || 0) * Number(o.quantity || 0),
        src: "broker",
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [fundTxs, paperTrades, brokerOrders]);

  const credits = rows
    .filter((r) => r.kind === "CREDIT")
    .reduce((a, r) => a + r.amount, 0);
  const debits = rows
    .filter((r) => r.kind === "DEBIT")
    .reduce((a, r) => a + r.amount, 0);

  function exportCsv() {
    const head = "date,label,kind,amount,source\n";
    const body = rows
      .map(
        (r) =>
          `${new Date(r.at).toISOString()},${JSON.stringify(r.label)},${r.kind},${r.amount},${r.src}`,
      )
      .join("\n");
    const blob = new Blob([head + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "funds-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
    sileo.success({ title: "Ledger exported" });
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Ledger
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Every cash movement from your paper account.
            </p>
          </div>
          <button
            onClick={exportCsv}
            className="pressable h-9 rounded-md border border-border px-3 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/50"
          >
            EXPORT CSV
          </button>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center">
            <Loading />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mt-6">
              {[
                {
                  label: "Credits",
                  value: `+₹${credits.toFixed(0)}`,
                  tone: "text-positive",
                },
                {
                  label: "Debits",
                  value: `−₹${debits.toFixed(0)}`,
                  tone: "text-negative",
                },
                {
                  label: "Net",
                  value: `${credits - debits >= 0 ? "+" : ""}₹${(credits - debits).toFixed(0)}`,
                  tone:
                    credits - debits >= 0 ? "text-positive" : "text-negative",
                },
              ].map((c) => (
                <div key={c.label} className="border border-border bg-card p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </div>
                  <div
                    className={`display-num text-xl font-semibold mt-1 ${c.tone}`}
                  >
                    {c.value}
                  </div>
                </div>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="broker-card mt-6 p-8 text-[13px] text-muted-foreground">
                No entries yet. Add funds from{" "}
                <Link href="/portfolio" className="underline">
                  Portfolio
                </Link>{" "}
                or place a trade.
              </div>
            ) : (
              <div className="border border-border bg-card mt-6">
                <div className="border-b border-border px-4 py-3 bg-muted hidden sm:block">
                  <div className="grid grid-cols-12 gap-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="col-span-3">Date</div>
                    <div className="col-span-6">Narration</div>
                    <div className="col-span-3 text-right">Amount</div>
                  </div>
                </div>
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 text-sm font-mono">
                      <div className="sm:col-span-3 text-foreground/60 text-xs self-center">
                        {new Date(r.at).toLocaleString("en-IN")}
                      </div>
                      <div className="sm:col-span-6">
                        {r.label}
                        <span className="ml-2 text-[10px] uppercase text-foreground/40">
                          {r.src}
                        </span>
                      </div>
                      <div
                        className={`sm:col-span-3 sm:text-right font-semibold ${
                          r.kind === "CREDIT"
                            ? "text-positive"
                            : "text-negative"
                        }`}
                      >
                        {r.kind === "CREDIT" ? "+" : "−"}₹
                        {r.amount.toLocaleString("en-IN", {
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Link
          href="/profile"
          className="inline-block mt-6 text-xs font-mono underline text-foreground/60"
        >
          ← Back to profile
        </Link>
      </div>
    </div>
  );
}
