"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FiStar,
  FiClipboard,
  FiBriefcase,
  FiTrendingUp,
  FiUser,
} from "react-icons/fi";

const TABS = [
  { href: "/watchlist", label: "LIST", Icon: FiStar },
  { href: "/portfolio/orders", label: "ORDERS", Icon: FiClipboard },
  { href: "/positions", label: "POSITION", Icon: FiBriefcase, hero: true },
  { href: "/options", label: "OPTS", Icon: FiTrendingUp },
  { href: "/profile", label: "PROFILE", Icon: FiUser },
];

function isActiveTab(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

// Floating broker dock: thumb-sized targets, hero FOLIO key, live glow.
export default function MobileBottomNav() {
  const path = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("fs_pending_orders");
      const arr = raw ? JSON.parse(raw) : [];
      setPendingCount(Array.isArray(arr) ? arr.length : 0);
    } catch {
      setPendingCount(0);
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fs_pending_orders") {
        try {
          const arr = e.newValue ? JSON.parse(e.newValue) : [];
          setPendingCount(Array.isArray(arr) ? arr.length : 0);
        } catch {
          setPendingCount(0);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [path]);

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="px-3 pointer-events-auto">
        <div className="mx-auto max-w-[520px] border border-border bg-card/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.45)]">
          <div className="h-[2px] w-full brand-gradient" />
          <div className="grid grid-cols-5">
            {TABS.map(({ href, label, Icon, hero }) => {
              const active = isActiveTab(path, href);
              if (hero) {
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="relative flex flex-col items-center justify-center gap-1 min-h-[60px] -mt-3 active:scale-95 transition-transform"
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center border transition-colors ${
                        active
                          ? "bg-positive text-positive-foreground border-positive shadow-[0_0_18px_rgba(38,166,154,0.55)]"
                          : "bg-foreground text-background border-foreground"
                      }`}
                    >
                      <Icon size={19} strokeWidth={2.2} />
                    </span>
                    <span
                      className={`text-[10.5px] font-medium ${active ? "text-positive" : "text-foreground/60"}`}
                    >
                      {label}
                    </span>
                    {active && (
                      <span className="absolute top-2 h-1 w-8 bg-positive" />
                    )}
                  </Link>
                );
              }
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center justify-center gap-1 min-h-[60px] active:scale-95 transition-colors ${
                    active ? "text-positive" : "text-foreground/60"
                  }`}
                >
                  {active && (
                    <span className="absolute top-0 h-[2px] w-10 bg-positive shadow-[0_0_12px_rgba(38,166,154,0.9)]" />
                  )}
                  <span className="relative">
                    <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                    {href === "/portfolio/orders" && pendingCount > 0 && (
                      <span className="absolute -top-2 -right-3 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-mono bg-negative text-negative-foreground">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                    {href === "/watchlist" && active && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 bg-positive animate-pulse" />
                    )}
                  </span>
                  <span className="text-[10.5px] font-medium">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
