"use client";
import { useState } from "react";
import { sileo } from "sileo";
import { addAlert, getAlerts, removeAlert } from "@/app/lib/alerts";

// LTP / % alert creator for current scrip.
export default function AlertBox(props: { symbol: string; ltp: number }) {
  const [op, setOp] = useState(">=" as ">=" | "<=");
  const [price, setPrice] = useState(props.ltp);
  const [list, setList] = useState(() =>
    typeof window === "undefined"
      ? []
      : getAlerts().filter((a) => a.scrip === props.symbol),
  );

  function save() {
    addAlert({ scrip: props.symbol, op, price });
    setList(getAlerts().filter((a) => a.scrip === props.symbol));
    sileo.success({ title: `Alert set ${props.symbol} ${op} ₹${price}` });
  }
  return (
    <div className="border border-border bg-card p-6">
      <h3 className="mb-4 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        Price alerts
      </h3>
      <div className="flex gap-2 mb-4">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as any)}
          className="border border-border bg-card px-3 py-2 text-sm font-mono"
        >
          <option value=">=">ABOVE ≥</option>
          <option value="<=">BELOW ≤</option>
        </select>
        <input
          type="number"
          step="0.05"
          value={price}
          onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
          className="flex-1 border border-border px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={save}
          className="text-xs font-mono bg-foreground text-background px-5"
        >
          SET
        </button>
      </div>
      {list.map((a) => (
        <div
          key={a.id}
          className="flex justify-between text-sm font-mono py-1.5 border-b border-border last:border-0"
        >
          <span className={a.hit ? "line-through opacity-60" : ""}>
            {a.scrip} {a.op} ₹{a.price} {a.hit ? "· HIT" : ""}
          </span>
          <button
            onClick={() => {
              removeAlert(a.id);
              setList(getAlerts().filter((x) => x.scrip === props.symbol));
            }}
            className="underline text-xs"
          >
            REMOVE
          </button>
        </div>
      ))}
    </div>
  );
}
