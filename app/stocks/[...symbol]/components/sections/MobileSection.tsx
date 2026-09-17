"use client";
import { useState, type ReactNode } from "react";
import { FiChevronDown } from "react-icons/fi";

// Collapsible section: always open on desktop, toggleable on mobile.
export default function MobileSection({
  title,
  meta,
  children,
  defaultOpen = false,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-border bg-card xl:border-0 xl:bg-transparent">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 min-h-[52px] text-left active:bg-muted transition-colors xl:hidden"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-foreground/80">
          {title}
          {meta && (
            <span className="text-[10px] text-foreground/40">{meta}</span>
          )}
        </span>
        <FiChevronDown
          size={18}
          className={`shrink-0 text-foreground/60 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className="hidden xl:block">{children}</div>
      <div
        className={`grid transition-all duration-200 xl:hidden ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-0 py-0 [&>div]:border-0 [&>div]:bg-transparent">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
