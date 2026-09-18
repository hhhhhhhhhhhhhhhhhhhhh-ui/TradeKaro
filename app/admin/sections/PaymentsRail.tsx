"use client";
import { useEffect, useState } from "react";

// Live view of the payment rail: what the gateway says we hold, what came in,
// and what it told us that we could not act on.
//
// The last part is the reason this exists. A rejected signature or an order id
// we do not recognise is invisible everywhere else in the console — no money
// moves, so nothing else notices — and those rows are precisely what explains a
// customer saying "I paid and my balance never changed".

type Row = {
  ts: number;
  event: string;
  txn_id: string | null;
  ref_id: string | null;
  status: string | null;
  signature_ok: number;
  outcome: string;
};

type Payload = {
  status: {
    enabled: boolean;
    payoutsEnabled: boolean;
    payinReady: boolean;
    payoutReady: boolean;
    minAmount: number;
    maxAmount: number;
    baseUrl: string;
    payinKeyHint: string;
    payoutKeyHint: string;
  };
  counts: {
    orders: { status: string; n: number; total: number }[];
    webhooks: { outcome: string; n: number }[];
  };
  webhooks: Row[];
  balance: {
    currency: string;
    balance: number;
    upstream_balance?: number;
  } | null;
  balanceError: string | null;
};

const BAD = new Set([
  "bad_signature",
  "unknown_order",
  "unknown_payout",
  "amount_mismatch",
  "credit_refused",
]);

function tone(outcome: string) {
  if (outcome === "credited") return "text-positive";
  if (BAD.has(outcome)) return "text-negative";
  return "text-muted-foreground";
}

export default function PaymentsRail() {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/admin/payments", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) setErr(j.error || "Could not read payment status");
        else {
          setErr("");
          setD(j);
        }
      } catch (e: any) {
        if (alive) setErr(e?.message || "Could not read payment status");
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (err)
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
        Payment status unavailable — {err}
      </div>
    );
  if (!d)
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
        Reading payment status…
      </div>
    );

  const rejected = d.counts.webhooks.filter((w) => BAD.has(w.outcome));
  const credited = d.counts.orders.find((o) => o.status === "success");
  const pending = d.counts.orders.filter(
    (o) => o.status === "pending" || o.status === "processing",
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "Gateway", v: d.status.enabled ? "Live" : "Off" },
          {
            k: "Keys",
            v: `in ${d.status.payinReady ? "ok" : "—"} / out ${
              d.status.payoutReady ? "ok" : "—"
            }`,
          },
          {
            k: "Collected",
            v: credited
              ? `₹${Number(credited.total).toLocaleString("en-IN")}`
              : "₹0",
          },
          {
            k: "Balance",
            v: d.balance
              ? `₹${Number(d.balance.balance).toLocaleString("en-IN")}`
              : d.balanceError
                ? "—"
                : "—",
          },
        ].map((x) => (
          <div
            key={x.k}
            className="rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {x.k}
            </div>
            <div className="text-[13px] font-semibold">{x.v}</div>
          </div>
        ))}
      </div>

      {d.balanceError ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-[12px]">
          Gateway balance unreadable — {d.balanceError}
        </div>
      ) : null}

      {rejected.length ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-[12px]">
          <span className="font-semibold">Callbacks we could not act on:</span>{" "}
          {rejected.map((r) => `${r.outcome} ×${r.n}`).join(", ")}. A rejected
          signature means the API secret is wrong; an unknown order means the
          callback arrived for something we never created.
        </div>
      ) : null}

      {pending.length ? (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          {pending.reduce((s, p) => s + Number(p.n), 0)} order(s) awaiting
          payment.
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-[11.5px] font-semibold">
          Webhook URLs to paste into the gateway dashboard
        </div>
        <div className="space-y-1 font-mono text-[11px]">
          <div className="truncate rounded border border-border bg-muted/40 px-2 py-1">
            {origin}/api/payments/webhook/payin
          </div>
          <div className="truncate rounded border border-border bg-muted/40 px-2 py-1">
            {origin}/api/payments/webhook/payout
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11.5px] font-semibold">Recent callbacks</div>
        {!d.webhooks.length ? (
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
            Nothing received yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-[11.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">When</th>
                  <th className="px-2 py-1.5 font-semibold">Order</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                  <th className="px-2 py-1.5 font-semibold">Signature</th>
                  <th className="px-2 py-1.5 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {d.webhooks.slice(0, 12).map((w, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-2 py-1.5 font-mono">
                      {new Date(w.ts).toLocaleTimeString("en-IN")}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{w.ref_id || "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{w.status || "—"}</td>
                    <td
                      className={`px-2 py-1.5 ${w.signature_ok ? "text-positive" : "text-negative"}`}
                    >
                      {w.signature_ok ? "ok" : "rejected"}
                    </td>
                    <td className={`px-2 py-1.5 ${tone(w.outcome)}`}>
                      {w.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
