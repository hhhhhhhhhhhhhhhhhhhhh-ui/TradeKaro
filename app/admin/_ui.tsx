"use client";
import type { ReactNode } from "react";
import { FiAlertTriangle, FiSearch } from "react-icons/fi";

// Admin console UI kit. Now built on the app's own design tokens
// (background/card/muted/brand) rather than a separate slate+indigo palette,
// so the console matches the trading surface in both light and dark themes.

export function Card({
  title,
  sub,
  children,
  action,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="broker-card p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </div>
          {sub ? (
            <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {sub}
            </div>
          ) : null}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  tone,
  sub,
  icon,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "muted";
  sub?: string;
  icon?: ReactNode;
}) {
  const bar =
    tone === "up"
      ? "bg-positive"
      : tone === "down"
        ? "bg-negative"
        : "bg-border";
  return (
    <div className="broker-card relative overflow-hidden p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="flex items-center justify-between gap-2 pl-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {icon ? <span className="text-muted-foreground/70">{icon}</span> : null}
      </div>
      <div className="mt-1 pl-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 pl-2 text-[12px] text-muted-foreground">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "min-h-[40px] w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 disabled:bg-muted/50 disabled:opacity-60";

export const selectCls =
  "min-h-[40px] rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground/80 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60";

export const btnPrimary =
  "pressable min-h-[40px] whitespace-nowrap rounded-md bg-foreground px-4 text-[12px] font-semibold tracking-wide text-background transition-colors hover:bg-foreground/90 disabled:opacity-50";

export const btnGhost =
  "pressable min-h-[40px] whitespace-nowrap rounded-md border border-border bg-card px-4 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-50";

export const btnDanger =
  "pressable min-h-[40px] whitespace-nowrap rounded-md bg-negative px-4 text-[12px] font-semibold text-negative-foreground transition-colors hover:bg-negative/90 disabled:opacity-50";

export const btnDark =
  "pressable min-h-[40px] whitespace-nowrap rounded-md bg-brand px-4 text-[12px] font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50";

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "red" | "amber" | "blue" | "indigo";
  children: ReactNode;
}) {
  const map: Record<string, string> = {
    slate: "border-border bg-muted/60 text-muted-foreground",
    green: "border-positive/30 bg-positive/10 text-positive",
    red: "border-negative/30 bg-negative/10 text-negative",
    amber: "border-accent/30 bg-accent/10 text-accent",
    blue: "border-brand/30 bg-brand/10 text-brand",
    indigo: "border-brand/30 bg-brand/10 text-brand",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      {children}
    </div>
  );
}

export const thCls =
  "whitespace-nowrap bg-muted/60 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
export const tdCls = "px-3 py-2.5 text-[13px] text-foreground/85";
export const trCls =
  "border-t border-border/60 first:border-0 hover:bg-muted/40";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  onGo,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onGo: () => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <FiSearch
        size={14}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onGo();
        }}
        placeholder={placeholder || "Search…"}
        className={`${inputCls} pl-8`}
      />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
      <div className="text-[13px] font-semibold text-foreground/80">
        {title}
      </div>
      {hint ? (
        <div className="max-w-md text-[12px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1)
    return (
      <div className="flex items-center justify-between px-1 py-1 text-[12px] text-muted-foreground">
        <span>
          Showing {total} record{total === 1 ? "" : "s"}
        </span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1">
      <span className="text-[12px] text-muted-foreground">
        Page {page} of {pages} · {total} records
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(1)}
          className={btnGhost}
          style={{ minHeight: 32, padding: "0 10px" }}
        >
          «
        </button>
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={btnGhost}
          style={{ minHeight: 32, padding: "0 10px" }}
        >
          ‹ Prev
        </button>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className={btnGhost}
          style={{ minHeight: 32, padding: "0 10px" }}
        >
          Next ›
        </button>
        <button
          disabled={page >= pages}
          onClick={() => onPage(pages)}
          className={btnGhost}
          style={{ minHeight: 32, padding: "0 10px" }}
        >
          »
        </button>
      </div>
    </div>
  );
}

export function PageHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {sub ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

// ── Enterprise controls ───────────────────────────────────────────────────

/** Accessible on/off switch. `tone="danger"` marks kill-switch style controls. */
export function Switch({
  checked,
  onChange,
  disabled,
  tone = "normal",
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  tone?: "normal" | "danger";
  label: string;
}) {
  const onBg = tone === "danger" ? "bg-negative" : "bg-brand";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-40 ${
        checked ? onBg : "bg-muted-foreground/35"
      }`}
    >
      <span
        className={`absolute h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: string;
  children?: ReactNode;
}) {
  const map = {
    info: "border-brand/30 bg-brand/10 text-brand",
    warn: "border-accent/30 bg-accent/10 text-accent",
    danger: "border-negative/30 bg-negative/10 text-negative",
    success: "border-positive/30 bg-positive/10 text-positive",
  } as const;
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${map[tone]}`}>
      {title ? (
        <div className="text-[12.5px] font-semibold">{title}</div>
      ) : null}
      {children ? (
        <div className="mt-0.5 text-[12px] leading-relaxed opacity-90">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Status summary strip: label + state pill, used above emergency controls. */
export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "off";
  children: ReactNode;
}) {
  const map = {
    ok: "border-positive/30 bg-positive/10 text-positive",
    warn: "border-accent/30 bg-accent/10 text-accent",
    off: "border-border bg-muted/60 text-muted-foreground",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${map[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export type ConfirmSpec = {
  title: string;
  /** What is about to change, e.g. "Maintenance mode: OFF → ON". */
  change: string;
  /** Blast radius — shown as a bulleted warning list. */
  consequences: string[];
  confirmLabel: string;
  tone: "danger" | "primary";
  /** Type this exact text to unlock the confirm button (high-risk actions). */
  requireText?: string;
  onConfirm: () => void;
};

/**
 * Blocking confirmation for destructive / platform-wide actions. Shows the
 * state change, the blast radius, and (optionally) requires typing a phrase
 * before the action can be committed.
 */
export function ConfirmDialog({
  spec,
  typed,
  onTyped,
  onCancel,
}: {
  spec: ConfirmSpec;
  typed: string;
  onTyped: (v: string) => void;
  onCancel: () => void;
}) {
  const unlocked = !spec.requireText || typed.trim() === spec.requireText;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={spec.title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`h-1 w-full ${spec.tone === "danger" ? "bg-negative" : "bg-brand"}`}
        />
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                spec.tone === "danger"
                  ? "border-negative/30 bg-negative/10 text-negative"
                  : "border-brand/30 bg-brand/10 text-brand"
              }`}
            >
              <FiAlertTriangle size={17} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                {spec.title}
              </h2>
              <p className="mt-1 font-mono text-[12.5px] text-muted-foreground">
                {spec.change}
              </p>
            </div>
          </div>

          {spec.consequences.length ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                This will affect
              </div>
              <ul className="mt-1.5 space-y-1">
                {spec.consequences.map((c) => (
                  <li
                    key={c}
                    className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/80"
                  >
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {spec.requireText ? (
            <div className="mt-4">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Type{" "}
                <span className="font-mono font-semibold text-foreground">
                  {spec.requireText}
                </span>{" "}
                to confirm
              </label>
              <input
                autoFocus
                value={typed}
                onChange={(e) => onTyped(e.target.value)}
                placeholder={spec.requireText}
                className={`${inputCls} mt-1.5 font-mono`}
              />
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onCancel} className={btnGhost}>
              Cancel
            </button>
            <button
              disabled={!unlocked}
              onClick={spec.onConfirm}
              className={
                spec.tone === "danger"
                  ? `${btnDanger} disabled:cursor-not-allowed disabled:opacity-40`
                  : `${btnPrimary} disabled:cursor-not-allowed disabled:opacity-40`
              }
            >
              {spec.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bordered form group used inside settings tabs. */
export function Group({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[12px] text-muted-foreground/80">{sub}</div>
      ) : null}
      <div className="mt-2.5 flex flex-col gap-2">{children}</div>
    </div>
  );
}
