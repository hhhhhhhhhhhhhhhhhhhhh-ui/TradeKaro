import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import LightweightMainChart from "./charts/LightweightMainChart";
import TradesOnChart from "./charts/TradesOnChart";

export default function HighChart(props: any) {
  const raw = Array.isArray(props.symbol) ? props.symbol[0] : props.symbol;
  const symbol = String(raw || "").toUpperCase();
  const { ticks } = useLiveTicks([symbol], 5000);
  const liveLtp = ticks[symbol]?.ltp;

  return (
    <div>
      <div className="border-t border-dashed border-border pt-4 mb-5 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          CHART
        </span>
        {liveLtp ? (
          <span className="text-xs font-mono text-foreground/60">
            LIVE ₹{Number(liveLtp).toFixed(2)} · UPSTOX
          </span>
        ) : null}
      </div>

      <div className="-mx-4 sm:mx-0 border-y sm:border border-border bg-card pt-3 sm:pt-4 overflow-hidden">
        <LightweightMainChart symbol={symbol} />
      </div>
      <TradesOnChart symbol={symbol} />
    </div>
  );
}
