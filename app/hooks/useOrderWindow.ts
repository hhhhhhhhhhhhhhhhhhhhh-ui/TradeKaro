"use client";
import { useEffect, useRef, useState } from "react";
import { usePublicConfig } from "./usePublicConfig";
import { orderWindow, type MarketPhase } from "@/app/lib/marketClock";

export type OrderWindowState = {
  /**
   * False only once we KNOW the session is shut. It stays true for the first
   * paint so server-rendered HTML and the hydrating client agree — deciding
   * "closed" during render would differ across the opening/closing boundary and
   * trip a hydration mismatch.
   */
  allowed: boolean;
  /** User-facing explanation. Empty while allowed. */
  reason: string;
  phase: MarketPhase;
  /** True after the first client-side evaluation. */
  checked: boolean;
};

const TICK_MS = 30_000;

/**
 * Live "may I place an order right now" state for tickets and order buttons.
 *
 * Re-evaluates on a timer, so a ticket left open across the closing bell locks
 * itself instead of failing on submit. Mirrors the server's check exactly — both
 * call `orderWindow`, so the button and the ledger can never disagree.
 */
export function useOrderWindow(): OrderWindowState {
  const cfg = usePublicConfig();
  const allowAfterHours = cfg.trading?.allowAfterHours === true;
  // Cheap dependency key: the config object is rebuilt on every poll, so keying
  // the effect on the object itself would restart the timer every few seconds.
  const hoursKey = [
    cfg.marketHours?.open,
    cfg.marketHours?.close,
    (cfg.marketHours?.holidays || []).join(","),
  ].join("|");

  const [state, setState] = useState<OrderWindowState>({
    allowed: true,
    reason: "",
    phase: "LIVE",
    checked: false,
  });

  const latest = useRef({ hours: cfg.marketHours, allowAfterHours });
  latest.current = { hours: cfg.marketHours, allowAfterHours };

  useEffect(() => {
    const tick = () => {
      const w = orderWindow(
        latest.current.hours,
        latest.current.allowAfterHours,
      );
      setState({
        allowed: w.allowed,
        reason: w.reason,
        phase: w.phase,
        checked: true,
      });
    };
    tick();
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, [hoursKey, allowAfterHours]);

  return state;
}
