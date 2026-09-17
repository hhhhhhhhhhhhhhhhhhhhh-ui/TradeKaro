"use client";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import {
  FiBriefcase,
  FiTrendingUp,
  FiCrosshair,
  FiStar,
  FiClipboard,
  FiZap,
} from "react-icons/fi";

// Shortcut grid to the main broker surfaces.
const SHORTCUTS = [
  { label: "Portfolio", href: "/portfolio", Icon: FiBriefcase },
  { label: "Options", href: "/options", Icon: FiTrendingUp },
  { label: "Screener", href: "/screener", Icon: FiCrosshair },
  { label: "Watchlist", href: "/watchlist", Icon: FiStar },
  { label: "Orders", href: "/portfolio/orders", Icon: FiClipboard },
  { label: "Top Movers", href: "/topmovers", Icon: FiZap },
];

export default function ShortcutsGrid() {
  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="eyebrow">Shortcuts</span>
        <span className="text-[11px] font-mono text-foreground/40">
          press ⌘K to jump
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y divide-border">
        {SHORTCUTS.map(({ label, href, Icon }) => (
          <NavTransition
            key={href + label}
            href={href}
            className="pressable flex items-center gap-3 p-4 hover:bg-muted transition group"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-foreground/70 transition-colors group-hover:text-foreground">
              <Icon className="text-base" />
            </span>
            <span className="text-sm font-mono">{label}</span>
          </NavTransition>
        ))}
      </div>
    </div>
  );
}
