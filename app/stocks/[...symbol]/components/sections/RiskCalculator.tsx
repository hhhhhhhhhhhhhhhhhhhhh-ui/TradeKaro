"use client";
import { useState } from "react";

// Position-size + stop-loss helper shown on stock page.
export default function RiskCalculator(props: { ltp: number; symbol: string }) {
  const [capital, setCapital] = useState(250000);
  const [riskPct, setRiskPct] = useState(1);
  const [stopPct, setStopPct] = useState(2);
  const riskAmt = (capital * riskPct) / 100;
  const stopDist = (props.ltp * stopPct) / 100;
  const qty = stopDist > 0 ? Math.floor(riskAmt / stopDist) : 0;
  const rows = [
    { l: "RISK AMOUNT", v: `₹${riskAmt.toFixed(2)}` },
    { l: "STOP DISTANCE", v: `₹${stopDist.toFixed(2)} (${stopPct}%)` },
    { l: "SUGGESTED QTY", v: String(qty) },
    { l: "POSITION VALUE", v: `₹${(qty * props.ltp).toFixed(2)}` },
  ];
  return (
    <div className="border border-border bg-card p-6">
      <h3 className="mb-4 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        Risk calculator · {props.symbol}
      </h3>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <label className="text-xs font-mono">
          CAPITAL
          <input
            type="number"
            value={capital}
            onChange={(e) => setCapital(parseFloat(e.target.value) || 0)}
            className="mt-1 w-full border border-border px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="text-xs font-mono">
          RISK %
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={(e) => setRiskPct(parseFloat(e.target.value) || 0)}
            className="mt-1 w-full border border-border px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="text-xs font-mono">
          STOP %
          <input
            type="number"
            step="0.1"
            value={stopPct}
            onChange={(e) => setStopPct(parseFloat(e.target.value) || 0)}
            className="mt-1 w-full border border-border px-2 py-1.5 text-sm font-mono"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rows.map((r) => (
          <div key={r.l} className="border border-border px-3 py-2">
            <div className="text-[10px] font-mono text-foreground/60">
              {r.l}
            </div>
            <div className="text-sm font-mono font-semibold">{r.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
