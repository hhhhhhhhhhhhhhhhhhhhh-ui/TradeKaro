"use client";
import { useEffect, useState } from "react";
import { FiAlertTriangle, FiClock } from "react-icons/fi";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { istInstant, marketPhase } from "@/app/lib/marketClock";

/**
 * Broker-style square-off warning for intraday (MIS) legs.
 *
 * Real brokers nag before the cutoff — the position is going to be closed at a
 * price the customer did not pick, so they get a countdown rather than a
 * surprise in the tradebook. This mirrors that, and deliberately states the
 * cutoff time instead of implying the customer has all day.
 */
export default function MisSquareOffNotice({ count }: { count: number }) {
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

  const cutoff = cfg.trading?.squareOffTime || "15:15";
  const now = new Date();
  const phase = marketPhase(cfg.marketHours, now);
  const minsLeft = Math.round(
    (istInstant(now, cutoff) - now.getTime()) / 60_000,
  );

  let tone: "info" | "warn" | "urgent" = "info";
  let text: string;

  if (phase === "WEEKEND" || phase === "HOLIDAY") {
    text = `Intraday legs are squared off at ${cutoff} IST on the next trading day.`;
  } else if (phase === "PRE") {
    text = `Intraday legs will be squared off automatically at ${cutoff} IST today.`;
  } else if (phase === "POST") {
    text = `The ${cutoff} IST square-off cutoff has passed — intraday legs are closed at the cutoff and never carried overnight.`;
  } else if (minsLeft <= 0) {
    tone = "urgent";
    text = `Square-off window: intraday legs are being closed at market (cutoff ${cutoff} IST).`;
  } else if (minsLeft <= 15) {
    tone = "urgent";
    text = `${count} intraday leg${count > 1 ? "s" : ""} will be squared off at market in ${minsLeft} min (cutoff ${cutoff} IST).`;
  } else {
    tone = minsLeft <= 60 ? "warn" : "info";
    const h = Math.floor(minsLeft / 60);
    const m = minsLeft % 60;
    const left = h ? `${h}h ${m}m` : `${m}m`;
    text = `${count} intraday leg${count > 1 ? "s" : ""} squared off automatically at ${cutoff} IST — ${left} left.`;
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
