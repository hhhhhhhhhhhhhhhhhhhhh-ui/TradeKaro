"use client";
import { useState } from "react";

// Compact/comfortable row density switch persisted locally.
export default function DensityToggle() {
  const [d, setD] = useState(() =>
    typeof document === "undefined"
      ? "comfortable"
      : document.documentElement.dataset.density || "comfortable",
  );
  function flip() {
    const next = d === "comfortable" ? "compact" : "comfortable";
    setD(next);
    document.documentElement.dataset.density = next;
    document.documentElement.classList.toggle(
      "density-compact",
      next === "compact",
    );
    document.documentElement.classList.toggle(
      "density-comfortable",
      next !== "compact",
    );
    try {
      localStorage.setItem("fs_density", next);
    } catch {
      /* ignore */
    }
  }
  if (
    typeof document !== "undefined" &&
    !document.documentElement.dataset.density
  ) {
    const saved = (() => {
      try {
        return localStorage.getItem("fs_density");
      } catch {
        return null;
      }
    })();
    if (saved) {
      document.documentElement.dataset.density = saved;
      document.documentElement.classList.toggle(
        "density-compact",
        saved === "compact",
      );
    } else {
      document.documentElement.classList.add("density-comfortable");
    }
  }
  return (
    <button
      onClick={flip}
      title="Toggle density"
      className="h-[34px] rounded-md border border-border px-3 text-[11px] font-medium text-foreground/70 transition-colors hover:bg-muted"
    >
      {d === "comfortable" ? "COMPACT" : "COMFY"}
    </button>
  );
}
