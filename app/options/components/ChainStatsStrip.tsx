"use client";
import { calcStats, type ChainRow } from "@/app/options/components/optTypes";

export default function ChainStatsStrip({
  rows,
  ltp,
  live,
  expiry,
  count,
  marginPct,
}: {
  rows: ChainRow[];
  ltp: number;
  live: boolean;
  expiry: string;
  count: number;
  /** % of premium the ledger blocks, resolved per user. 5 ⇒ 20x. */
  marginPct: number;
}) {
  const s = calcStats(rows, ltp);
  // Distance from spot to max-pain: how far expiry magnet sits.
  const painGap =
    s && ltp > 0 ? (((s.maxPain - ltp) / ltp) * 100).toFixed(2) : null;
  const pcrW = s ? Math.min(100, Math.max(0, (s.pcr / 2) * 100)) : 0;
  const cells: { label: string; value: string; tone?: string; sub?: string }[] =
    [
      {
        label: "UNDERLYING",
        value: `₹${ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
        sub: live ? "● LIVE" : "○ OFFLINE",
        tone: live ? "text-positive" : "text-foreground/50",
      },
      { label: "EXPIRY", value: expiry || "—", sub: `${count} strikes` },
      {
        // How much of the premium has to be in the wallet. Without this the
        // chain showed the exposure (spots, OI, max pain) and never the one
        // number that decides whether a leg can be opened at all.
        label: "MARGIN",
        value: `${marginPct}%`,
        sub:
          marginPct > 0
            ? `${Math.round((100 / marginPct) * 10) / 10}x on premium`
            : "—",
      },
      {
        label: "PCR (OI)",
        value: s ? s.pcr.toFixed(2) : "—",
        sub: s
          ? s.pcr > 1
            ? "bullish lean"
            : s.pcr < 0.7
              ? "bearish lean"
              : "neutral"
          : undefined,
      },
      {
        label: "MAX PAIN",
        value: s ? String(s.maxPain) : "—",
        sub:
          painGap != null
            ? `${Number(painGap) >= 0 ? "+" : ""}${painGap}% from spot`
            : "expiry magnet",
      },
      {
        label: "SUPPORT (PE OI)",
        value: s ? String(s.support) : "—",
        tone: "text-positive",
      },
      {
        label: "RESISTANCE (CE OI)",
        value: s ? String(s.resistance) : "—",
        tone: "text-negative",
      },
    ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-2 sm:gap-3">
        {cells.map((c) => (
          <div
            key={c.label}
            className="broker-card broker-card-hover px-4 py-3"
          >
            <div className="eyebrow">{c.label}</div>
            <div
              className={`display-num mt-1 text-lg font-semibold ${c.tone ?? ""}`}
            >
              {c.value}
            </div>
            {c.sub && (
              <div className="mt-0.5 text-[11px] font-mono text-foreground/45">
                {c.sub}
              </div>
            )}
            {c.label === "PCR (OI)" && s && (
              <div
                className="mt-2 h-1 rounded bg-muted overflow-hidden"
                role="img"
                aria-label={`PCR ${s.pcr.toFixed(2)}`}
              >
                <div
                  className={`h-full ${s.pcr > 1 ? "bg-positive" : s.pcr < 0.7 ? "bg-negative" : "bg-brand"}`}
                  style={{ width: `${pcrW}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
