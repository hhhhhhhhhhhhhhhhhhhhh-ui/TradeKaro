"use client";
// Shared presentation primitives for account pages (profile, KYC, banks,
// security). Keeps one visual language: sans for labels, mono only for
// numerals/IDs, react-icons instead of emoji, tinted status badges.

import type { ReactNode } from "react";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import { FiChevronRight } from "react-icons/fi";

// ── Form / button styling ─────────────────────────────────────────────────
export const inputClass =
  "mt-1 w-full h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
export const textareaClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
export const labelClass = "text-[11px] font-medium text-muted-foreground";

export const btnPrimary =
  "pressable inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-[12px] font-semibold text-background disabled:opacity-50";
export const btnGhost =
  "pressable inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/50 disabled:opacity-50";
export const btnDanger =
  "pressable inline-flex h-10 items-center justify-center gap-2 rounded-md border border-negative/40 px-4 text-[12px] font-semibold text-negative transition-colors hover:bg-negative/10 disabled:opacity-50";

// ── Primitives ────────────────────────────────────────────────────────────
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "brand";
}) {
  const cls =
    tone === "positive"
      ? "border-positive/30 bg-positive/10 text-positive"
      : tone === "negative"
        ? "border-negative/30 bg-negative/10 text-negative"
        : tone === "brand"
          ? "border-brand/30 bg-brand/10 text-brand"
          : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-current" />;
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`broker-card p-5 ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-muted-foreground/70">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[13px] text-muted-foreground/80">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="broker-card mt-3 divide-y divide-border/60 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

// A row is a link when `href` is given, otherwise a plain status row.
export function Row({
  href,
  icon,
  label,
  sub,
  badge,
  onClick,
}: {
  href?: string;
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      {icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-foreground/70 transition-colors group-hover:text-foreground">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">
          {label}
        </span>
        {sub ? (
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
      {badge}
      {href || onClick ? (
        <FiChevronRight
          size={16}
          aria-hidden
          className="shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  );
  const base =
    "group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors";
  if (href)
    return (
      <NavTransition
        href={href}
        className={`${base} hover:bg-muted/40 active:bg-muted/60`}
      >
        {body}
      </NavTransition>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} hover:bg-muted/40 active:bg-muted/60`}
      >
        {body}
      </button>
    );
  return <div className={base}>{body}</div>;
}

// Back link + title + description, used at the top of every account page.
export function AccountHeader({
  title,
  description,
  backHref = "/profile",
  backLabel = "Account",
  badge,
  actions,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      <NavTransition
        href={backHref}
        className="inline-flex items-center text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {backLabel}
      </NavTransition>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </h1>
            {badge}
          </div>
          {description ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
