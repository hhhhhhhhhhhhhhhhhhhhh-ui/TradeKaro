"use client";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";

const FALLBACK_TAPE = [
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "RELIANCE",
  "TCS",
  "INFY",
  "SBIN",
  "TATAMOTORS",
  "HDFCBANK",
];

// Scrolling index/liquid-name tape under the navbar.
export default function TickerTape() {
  const { tape } = usePublicConfig();
  const TAPE = tape?.length ? tape : FALLBACK_TAPE;
  const { ticks } = useLiveTicks(TAPE, 8000);
  const items = TAPE.map((s) => ({ s, t: ticks[s] }));
  const row = (keySuffix: string) => (
    <div key={keySuffix} className="flex shrink-0">
      {items.map(({ s, t }) => (
        <a
          key={s + keySuffix}
          href={`/stocks/${s}`}
          className="flex min-h-[44px] items-center gap-2 whitespace-nowrap border-r border-border px-5 py-2.5 text-[12.5px] hover:bg-muted active:bg-muted md:min-h-0 md:py-1.5"
        >
          <span className="font-medium text-foreground/60">{s}</span>
          {t ? (
            <span
              className={`font-mono tabular-nums ${t.ltp >= (t.close ?? t.ltp) ? "text-positive" : "text-negative"}`}
            >
              ₹{Number(t.ltp).toFixed(2)}
            </span>
          ) : (
            <span className="skeleton inline-block h-3 w-14" />
          )}
        </a>
      ))}
    </div>
  );
  return (
    <div className="border-y border-border bg-card overflow-hidden">
      <div className="tape-track flex w-max">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
