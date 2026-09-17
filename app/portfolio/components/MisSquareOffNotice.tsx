"use client";
import { useEffect, useState } from "react";
import { FiAlertTriangle, FiClock } from "react-icons/fi";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import {
  EQUITY_EXCHANGE,
  EXCHANGE_LABEL,
  istInstant,
  misCutoff,
  segmentPhase,
  type ExchangeCode,
} from "@/app/lib/marketClock";

/**
 * Broker-style square-off warning for intraday (MIS) legs.
 *
 * Real brokers nag before the cutoff — the position is going to be closed at a
 * price the customer did not pick, so they get a countdown rather than a
 * surprise in the tradebook. This mirrors that, and deliberately states the
 * cutoff time instead of implying the customer has all day.
 *
 * It is PER SEGMENT. The exchanges do not share a cutoff — cash is squared off
 * at 15:15 and MCX at 23:25 — so a single global time was wrong for whichever
 * market it was not describing. A gold holder was shown a 15:15 countdown for a
 * leg that would actually be closed eight hours later.
 */
export default function MisSquareOffNotice({
  count,
  segments,
}: {
  count: number;
  /** Exchanges holding the open intraday legs. */
  segments: ExchangeCode[];
}) {
  const cfg = usePublicConfig();
  const [mounted, setMounted] = useState(false);
  const [, tick] = useState(0);

  // Mount-gate: the phase depends on the wall clock, which differs between the
  // server render and hydration. Also re-evaluate on a timer so the countdown
  // stays honest in a tab left open across the cutoff.
  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!mounted || count === 0) return null;
  if (cfg.trading?.autoSquareOff === false) return null;

  const now = new Date();
  const cal = cfg.calendar ?? null;
  const uniq = segments.length ? [...new Set(segments)] : [EQUITY_EXCHANGE];

  const legs = uniq.map((segment) => {
    const cutoff = misCutoff(
      cfg.marketHours,
      cfg.trading?.squareOffTime,
      now,
      segment,
      cal,
    );
    return {
      segment,
      name: EXCHANGE_LABEL[segment],
      cutoff,
      phase: segmentPhase(cfg.marketHours, now, segment, cal),
      minsLeft: Math.round((istInstant(now, cutoff) - now.getTime()) / 60_000),
    };
  });

  // The one that matters is the soonest still-open cutoff — that is the leg the
  // customer is about to lose first.
  const pending = legs.filter(
    (l) => l.phase !== "WEEKEND" && l.phase !== "HOLIDAY",
  );
  const lead = (pending.length ? pending : legs).reduce((a, b) =>
    a.minsLeft <= b.minsLeft ? a : b,
  );
  // Only name the venue when it is not the default one, so the common cash-only
  // case reads exactly as it did before.
  const where = lead.segment === EQUITY_EXCHANGE ? "" : `${lead.name} `;

  let tone: "info" | "warn" | "urgent" = "info";
  let text: string;

  if (lead.phase === "WEEKEND" || lead.phase === "HOLIDAY") {
    text = `Intraday legs are squared off at ${lead.cutoff} IST on the next trading day.`;
  } else if (lead.phase === "PRE") {
    text = `Intraday legs will be squared off automatically at ${where}${lead.cutoff} IST today.`;
  } else if (lead.phase === "POST") {
    text = `The ${where}${lead.cutoff} IST square-off cutoff has passed — intraday legs are closed at the cutoff and never carried overnight.`;
  } else if (lead.minsLeft <= 0) {
    tone = "urgent";
    text = `Square-off window: ${where}intraday legs are being closed at market (cutoff ${lead.cutoff} IST).`;
  } else if (lead.minsLeft <= 15) {
    tone = "urgent";
    text = `${count} intraday leg${count > 1 ? "s" : ""} will be squared off at market in ${lead.minsLeft} min (${where}cutoff ${lead.cutoff} IST).`;
  } else {
    tone = lead.minsLeft <= 60 ? "warn" : "info";
    const h = Math.floor(lead.minsLeft / 60);
    const m = lead.minsLeft % 60;
    const left = h ? `${h}h ${m}m` : `${m}m`;
    text = `${count} intraday leg${count > 1 ? "s" : ""} squared off automatically at ${where}${lead.cutoff} IST — ${left} left.`;
  }

  // More than one venue in play: say so rather than implying one deadline.
  if (legs.length > 1) {
    const parts = legs.map((l) => `${l.name} ${l.cutoff}`);
    text += ` Cutoffs in play: ${parts.join(", ")} IST.`;
  }

  const styles: Record<typeof tone, string> = {
    info: "border-border bg-muted/40 text-muted-foreground",
    warn: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    urgent: "border-negative/40 bg-negative/5 text-negative font-semibold",
  };

  return (
    <div
      role="status"
      className={`flex items-start gap-2 border px-3 py-2 text-[11.5px] font-mono ${styles[tone]}`}
    >
      {tone === "info" ? (
        <FiClock size={13} className="mt-[1px] shrink-0" aria-hidden />
      ) : (
        <FiAlertTriangle size={13} className="mt-[1px] shrink-0" aria-hidden />
      )}
      <span>{text}</span>
    </div>
  );
}
