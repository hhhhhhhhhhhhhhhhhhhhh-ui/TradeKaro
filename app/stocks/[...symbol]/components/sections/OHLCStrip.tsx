"use client";
import { useEffect, useRef, useState } from "react";

// OHLC + volume + day-range bar under the LTP header.
export default function OHLCStrip(props: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dayChangePerc: number;
}) {
  const [flash, setFlash] = useState<"up" | "down" | "">("");
  const prev = useRef(props.close);
  useEffect(() => {
    if (props.close > prev.current) setFlash("up");
    else if (props.close < prev.current) setFlash("down");
    prev.current = props.close;
    const id = setTimeout(() => setFlash(""), 700);
    return () => clearTimeout(id);
  }, [props.close]);

  const span = (props.high ?? 0) - (props.low ?? 0) || 1;
  const pos = Math.min(
    100,
    Math.max(0, (((props.close ?? 0) - (props.low ?? 0)) / span) * 100),
  );
  const cell = "flex flex-col gap-0.5";
  const label =
    "text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground";
  const val = "text-sm font-mono tnum";
  return (
    <div
      className={`mt-4 border border-border bg-card px-4 py-3 ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}`}
    >
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <div className={cell}>
          <span className={label}>Open</span>
          <span className={val}>₹{Number(props.open ?? 0).toFixed(2)}</span>
        </div>
        <div className={cell}>
          <span className={label}>High</span>
          <span className={`${val} text-positive`}>
            ₹{Number(props.high ?? 0).toFixed(2)}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Low</span>
          <span className={`${val} text-negative`}>
            ₹{Number(props.low ?? 0).toFixed(2)}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Close</span>
          <span className={val}>₹{Number(props.close ?? 0).toFixed(2)}</span>
        </div>
        <div className={cell}>
          <span className={label}>Volume</span>
          <span className={val}>
            {Number(props.volume ?? 0).toLocaleString("en-IN")}
          </span>
        </div>
        <div className={cell}>
          <span className={label}>Day</span>
          <span
            className={`${val} ${(props.dayChangePerc ?? 0) >= 0 ? "text-positive" : "text-negative"}`}
          >
            {(props.dayChangePerc ?? 0) >= 0 ? "+" : ""}
            {Number(props.dayChangePerc ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
          <span>₹{Number(props.low ?? 0).toFixed(2)}</span>
          <span>DAY RANGE</span>
          <span>₹{Number(props.high ?? 0).toFixed(2)}</span>
        </div>
        <div className="relative h-1.5 bg-muted">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-negative via-foreground/30 to-positive"
            style={{ width: "100%", opacity: 0.35 }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 w-3 bg-foreground border border-background"
            style={{ left: `calc(${pos}% - 6px)` }}
          />
        </div>
      </div>
    </div>
  );
}
