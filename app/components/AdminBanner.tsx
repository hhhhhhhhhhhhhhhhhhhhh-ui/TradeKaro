"use client";
import { useEffect, useState } from "react";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { FiAlertTriangle } from "react-icons/fi";

// Admin banner + maintenance + data-health bar.
// Priority: maintenance > provider halt > feed degraded/down > banner text.
export default function AdminBanner() {
  const cfg = usePublicConfig();
  const [health, setHealth] = useState<"" | "degraded" | "down">("");
  // The config comes from a client-side cache/fetch, so the server cannot know
  // whether the banner should show. Render nothing until mounted — otherwise
  // server (no banner) and client (banner) disagree and hydration fails.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (cfg.providerOff) {
      setHealth("");
      return;
    }
    let stop = false;
    async function probe() {
      try {
        const r = await fetch("/api/market/stats", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const state = j?.provider?.state;
        if (!stop)
          setHealth(
            state === "down" ? "down" : state === "degraded" ? "degraded" : "",
          );
      } catch {
        /* keep last state */
      }
    }
    probe();
    const id = setInterval(probe, 60000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [cfg.providerOff]);

  if (!mounted) return null;
  if (cfg.maintenance) {
    return (
      <div className="flex items-center justify-center gap-2 bg-negative px-4 py-3 text-[13px] font-medium text-negative-foreground">
        <FiAlertTriangle size={16} aria-hidden />
        Platform under maintenance — trading paused. Your positions and funds
        are safe.
      </div>
    );
  }
  if (cfg.providerOff) {
    return (
      <div className="border-b border-negative/40 bg-negative/10 px-4 py-2 text-center text-[12px] font-semibold uppercase tracking-wide text-negative">
        LIVE DATA HALTED BY ADMIN — SHOWING LAST KNOWN VALUES
      </div>
    );
  }
  if (health) {
    return (
      <div
        className={`border-b px-4 py-2 text-center text-[12px] font-semibold uppercase tracking-wide ${
          health === "down"
            ? "border-negative/40 bg-negative/10 text-negative"
            : "border-amber-500/40 bg-amber-500/10 text-amber-500"
        }`}
      >
        {health === "down"
          ? "DATA FEED DOWN — UPSTREAM UNAVAILABLE, RETRYING"
          : "DATA FEED DEGRADED — SOME VALUES MAY BE STALE"}
      </div>
    );
  }
  if (!cfg.banner) return null;
  return (
    <div className="bg-brand/10 border-b border-brand/20 text-center px-4 py-2 text-xs font-mono text-foreground/80">
      {cfg.banner}
    </div>
  );
}
