"use client";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import { FiChevronRight } from "react-icons/fi";

// Section heading used across dashboard/options: sans label, optional count
// chip, optional "view all" link. No decorative gradient rule.
export default function SectionHeader({
  eyebrow,
  count,
  href,
  linkLabel = "VIEW MORE",
  tone = "text-brand",
}: {
  eyebrow: string;
  count?: number | string;
  href?: string;
  linkLabel?: string;
  tone?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </h2>
        {count !== undefined && (
          <span className="shrink-0 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {href && (
        <NavTransition
          href={href}
          className={`group inline-flex shrink-0 items-center gap-0.5 text-[12px] font-medium ${tone} hover:underline`}
        >
          {linkLabel}
          <FiChevronRight
            size={13}
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          />
        </NavTransition>
      )}
    </div>
  );
}
