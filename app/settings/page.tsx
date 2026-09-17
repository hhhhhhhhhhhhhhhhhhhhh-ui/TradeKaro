"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/app/components/theme/ThemeProvider";
import { sileo } from "sileo";

const QTY_KEY = "fs_default_qty";
const CONFIRM_KEY = "fs_confirm_orders";

export default function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [density, setDensity] = useState("comfortable");
  const [defaultQty, setDefaultQty] = useState(1);
  const [confirm, setConfirm] = useState(true);

  useEffect(() => {
    try {
      setDensity(
        document.documentElement.dataset.density ||
          localStorage.getItem("fs_density") ||
          "comfortable",
      );
      setDefaultQty(Number(localStorage.getItem(QTY_KEY) || "1") || 1);
      setConfirm(localStorage.getItem(CONFIRM_KEY) !== "off");
    } catch {
      /* ignore */
    }
  }, []);

  function applyDensity(next: string) {
    setDensity(next);
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

  function saveQty(v: number) {
    const q = Math.max(1, Math.min(10000, Math.floor(v) || 1));
    setDefaultQty(q);
    try {
      localStorage.setItem(QTY_KEY, String(q));
    } catch {
      /* ignore */
    }
  }

  function flipConfirm() {
    const next = !confirm;
    setConfirm(next);
    try {
      localStorage.setItem(CONFIRM_KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
  }

  function resetPaper() {
    try {
      localStorage.removeItem("fs_positions");
      localStorage.removeItem("fs_tradebook");
      localStorage.removeItem("fs_funds");
      localStorage.removeItem("fs_pending_orders");
    } catch {
      /* ignore */
    }
    sileo.success({ title: "Trading data cleared" });
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Appearance, charts and order defaults. Everything is stored on this
          device.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Appearance */}
          <div className="broker-card p-5">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
            <div className="mt-4 space-y-4 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span>Theme</span>
                <div className="flex gap-2">
                  {(["light", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTheme(t);
                        try {
                          localStorage.setItem("theme", t);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className={`pressable h-9 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                        resolvedTheme === t
                          ? "border-transparent bg-foreground text-background"
                          : "border-border text-foreground/70 hover:bg-muted/50"
                      }`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Row density</span>
                <div className="flex gap-2">
                  {(["comfortable", "compact"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => applyDensity(d)}
                      className={`pressable h-9 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                        density === d
                          ? "border-transparent bg-foreground text-background"
                          : "border-border text-foreground/70 hover:bg-muted/50"
                      }`}
                    >
                      {d.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Trading defaults */}
          <div className="broker-card p-5">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Trading defaults
            </h2>
            <div className="mt-4 space-y-4 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span>Default quantity</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={defaultQty}
                  onChange={(e) => saveQty(Number(e.target.value))}
                  className="h-10 w-28 rounded-md border border-border bg-background px-3 text-center font-mono text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Confirm before placing order</span>
                <button
                  onClick={flipConfirm}
                  aria-pressed={confirm}
                  className={`pressable h-9 rounded-md border px-4 text-[12px] font-semibold transition-colors ${
                    confirm
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-foreground/70 hover:bg-muted/50"
                  }`}
                >
                  {confirm ? "ON" : "OFF"}
                </button>
              </div>
              <p className="text-[11px] text-foreground/40">
                Order tickets read the default quantity on open.
              </p>
            </div>
          </div>

          {/* Data */}
          <div className="border border-border bg-card p-6 lg:col-span-2">
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Local trading data
            </span>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={resetPaper}
                className="text-xs font-mono border border-negative/40 text-negative px-4 py-2 hover:border-negative transition"
              >
                CLEAR TRADING DATA
              </button>
              <span className="text-[11.5px] text-muted-foreground">
                Clears positions, order history, funds top-ups and pending
                orders on this device only.
              </span>
            </div>
          </div>
        </div>

        <Link
          href="/profile"
          className="inline-block mt-6 text-xs font-mono underline text-foreground/60"
        >
          ← Back to profile
        </Link>
      </div>
    </div>
  );
}
