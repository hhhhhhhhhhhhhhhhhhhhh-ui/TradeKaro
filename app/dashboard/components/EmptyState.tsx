"use client";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import type { ReactNode } from "react";
import { FiInbox } from "react-icons/fi";

export default function EmptyState({
  title,
  hint,
  href,
  actionLabel,
  icon,
}: {
  title: string;
  hint?: string;
  href?: string;
  actionLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="broker-card p-8 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/60 text-foreground/60">
        {icon ?? <FiInbox size={19} aria-hidden />}
      </span>
      <div className="mt-3 text-[13.5px] font-medium">{title}</div>
      {hint && (
        <div className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted-foreground">
          {hint}
        </div>
      )}
      {href && actionLabel && (
        <NavTransition
          href={href}
          className="pressable mt-4 inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[12px] font-semibold text-background"
        >
          {actionLabel}
        </NavTransition>
      )}
    </div>
  );
}
