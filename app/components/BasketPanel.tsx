"use client";
import { useState } from "react";
import { sileo } from "sileo";
import { apiURL } from "@/app/components/apiURL";
import axios from "axios";
import { getCookie } from "cookies-next";
import { executeFill, getBackendCash } from "@/app/lib/trading";
import { ensureInstrument } from "@/app/hooks/useInstrument";

// Multi-leg basket executed sequentially at live LTP.
export default function BasketPanel(props: {
  symbols: string[];
  ltps: Record<string, number>;
}) {
  const [rows, setRows] = useState<
    { scrip: string; qty: number; side: "BUY" | "SELL" }[]
  >(
    props.symbols
      .slice(0, 5)
      .map((s) => ({ scrip: s, qty: 1, side: "BUY" as const })),
  );
  const [busy, setBusy] = useState(false);
  const token = getCookie("token") as string | undefined;

  async function execute() {
    setBusy(true);
    let ok = 0;
    for (const r of rows) {
      if (!r.scrip || r.qty <= 0) continue;
      const ltp = props.ltps[r.scrip.toUpperCase()] ?? 0;
      let backendOk = false;
      try {
        await axios({
          method: "post",
          url:
            apiURL +
            (r.side === "BUY"
              ? "/transaction/buyScrip"
              : "/transaction/sellScrip"),
          headers: { Authorization: "Bearer " + token },
          data: { scrip: r.scrip, quantity: r.qty },
        });
        backendOk = true;
        ok++;
        continue;
      } catch {
        /* ledger fallback below */
      }
      if (backendOk) continue;
      // Resolve the instrument so the client session check uses the right
      // exchange — the default is NSE, which refuses a live commodity order.
      const meta = await ensureInstrument(r.scrip);
      try {
        executeFill({
          scrip: r.scrip,
          qty: r.qty,
          price: ltp,
          side: r.side,
          kind: "STOCK",
          backendCash: getBackendCash(),
          segment: meta?.segment,
        });
        ok++;
      } catch (e: any) {
        sileo.error({ title: e?.message || "Insufficient funds" });
        break;
      }
    }
    setBusy(false);
    sileo.success({ title: `Basket done: ${ok}/${rows.length} legs` });
  }

  return (
    <div className="border border-border bg-card p-6">
      <h3 className="mb-4 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        Basket order
      </h3>
      <div className="flex flex-col gap-2 mb-4">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-4 gap-2">
            <input
              value={r.scrip}
              onChange={(e) =>
                setRows(
                  rows.map((x, j) =>
                    j === i ? { ...x, scrip: e.target.value.toUpperCase() } : x,
                  ),
                )
              }
              className="border border-border px-2 py-1.5 text-sm font-mono"
              placeholder="SYMBOL"
            />
            <input
              type="number"
              min="1"
              value={r.qty}
              onChange={(e) =>
                setRows(
                  rows.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          qty: Math.max(1, parseInt(e.target.value) || 1),
                        }
                      : x,
                  ),
                )
              }
              className="border border-border px-2 py-1.5 text-sm font-mono"
            />
            <select
              value={r.side}
              onChange={(e) =>
                setRows(
                  rows.map((x, j) =>
                    j === i ? { ...x, side: e.target.value as any } : x,
                  ),
                )
              }
              className="border border-border bg-card px-2 py-1.5 text-sm font-mono"
            >
              <option>BUY</option>
              <option>SELL</option>
            </select>
            <button
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="text-xs font-mono border border-border hover:bg-muted"
            >
              REMOVE
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setRows([...rows, { scrip: "", qty: 1, side: "BUY" }])}
          className="text-xs font-mono border border-border px-4 py-2 hover:bg-muted"
        >
          + LEG
        </button>
        <button
          onClick={execute}
          disabled={busy}
          className="text-xs font-mono bg-foreground text-background px-6 py-2 disabled:opacity-50"
        >
          {busy ? "FIRING..." : `EXECUTE ${rows.length} LEGS`}
        </button>
      </div>
    </div>
  );
}
