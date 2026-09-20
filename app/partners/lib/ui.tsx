"use client";

// Presentation primitives for the affiliate panel. Same design tokens as the
// trading app (broker-card, brand-gradient, display-num) so the two surfaces
// feel like one product, but tuned denser — a partner panel is a work screen.

import type { ReactNode } from "react";
import { FiInbox } from "react-icons/fi";

export function PageHead({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "brand" | "positive" | "muted";
  icon?: ReactNode;
}) {
  const valueCls =
    tone === "brand"
      ? "text-brand"
      : tone === "positive"
        ? "text-positive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="broker-card broker-card-hover p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground/70">{icon}</span> : null}
      </div>
      <div
        className={`display-num mt-2 text-[21px] font-semibold leading-none ${valueCls}`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

/**
 * Dependency-free bar chart.
 *
 * Two series on one axis is a lie unless they share a unit, so `earned` is drawn
 * as its own row of bars underneath rather than overlaid on clicks. No charting
 * library: this renders ~40 divs and costs nothing on a phone.
 */
export function Bars({
  values,
  labels,
  tone = "brand",
  height = 56,
  format,
}: {
  values: number[];
  labels?: string[];
  tone?: "brand" | "positive";
  height?: number;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...values);
  const barCls = tone === "positive" ? "bg-positive/70" : "bg-brand/65";
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div
            key={i}
            // A 3px minimum keeps a zero day visible as a baseline rather than
            // as a gap, which otherwise reads as missing data.
            className={`flex-1 rounded-t-[3px] ${barCls} transition-[height] duration-300`}
            style={{ height: `${Math.max(3, (v / max) * height)}px` }}
            title={`${labels?.[i] ?? i}: ${format ? format(v) : v}`}
          />
        ))}
      </div>
      {labels?.length ? (
        <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      ) : null}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-muted/50 text-muted-foreground">
        {icon || <FiInbox size={18} />}
      </div>
      <div className="mt-3 text-[14px] font-semibold text-foreground">
        {title}
      </div>
      {body ? (
        <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`broker-card overflow-hidden ${className}`}>{children}</div>
  );
}

export function PanelHead({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {hint ? (
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/** Row primitives — one visual grammar for every list in the panel. */
export function TRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${className}`}
    >
      {children}
    </div>
  );
}

export function Skel({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="broker-card p-4">
      <Skel className="h-3 w-24" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skel key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

export function Notice({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "positive" | "negative" | "warn";
  children: ReactNode;
}) {
  const cls =
    tone === "positive"
      ? "border-positive/30 bg-positive/8 text-positive"
      : tone === "negative"
        ? "border-negative/30 bg-negative/8 text-negative"
        : tone === "warn"
          ? "border-amber-500/30 bg-amber-500/8 text-amber-600 dark:text-amber-400"
          : "border-brand/30 bg-brand/8 text-brand";
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed ${cls}`}
    >
      {children}
    </div>
  );
}

/** Segmented control. Used for ranges and tabs. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`pressable rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
