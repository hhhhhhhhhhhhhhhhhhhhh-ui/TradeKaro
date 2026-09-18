"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import useHasSession from "@/app/hooks/useHasSession";
import {
  FiStar,
  FiClipboard,
  FiBriefcase,
  FiTrendingUp,
  FiUser,
  FiActivity,
  FiFilter,
  FiBarChart2,
  FiLogIn,
  FiBox,
  FiCreditCard,
} from "react-icons/fi";

// Signed-in dock: the account surfaces a trader jumps between all day.
//
// Six, not five: WALLET is where money actually moves (deposit, withdraw, saved
// destinations) and it was previously buried as a tab inside the portfolio —
// which is not where anyone looks for their balance. Targets stay 60px tall.
const AUTH_TABS = [
  { href: "/watchlist", label: "LIST", Icon: FiStar },
  { href: "/portfolio/orders", label: "ORDERS", Icon: FiClipboard },
  { href: "/positions", label: "POSITION", Icon: FiBriefcase, hero: true },
  { href: "/wallet", label: "WALLET", Icon: FiCreditCard },
  { href: "/options", label: "OPTS", Icon: FiTrendingUp },
  { href: "/profile", label: "PROFILE", Icon: FiUser },
];

// Visitor dock. Four of the five signed-in tabs are account pages that would
// only bounce off the proxy, so they are swapped for the public market pages
// and the one action a visitor actually needs.
//
// Six entries, not five: a visitor has no hamburger — it renders only when
// signed in — so the dock is the ONLY navigation a logged-out phone user has,
// and /commodities was unreachable from it. The signed-in list stays at five
// because those are the account surfaces a trader jumps between.
//
// The column class is a literal per list, never `grid-cols-${n}`: a dynamic
// name would not survive Tailwind's build-time scan.
const GUEST_TABS = [
  { href: "/stocks", label: "STOCKS", Icon: FiTrendingUp },
  { href: "/screener", label: "SCREEN", Icon: FiFilter },
  { href: "/topmovers", label: "MOVERS", Icon: FiBarChart2 },
  { href: "/commodities", label: "COMMOD", Icon: FiBox },
  { href: "/options", label: "OPTS", Icon: FiActivity },
  { href: "/login", label: "LOGIN", Icon: FiLogIn, hero: true },
];

function isActiveTab(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

// Floating broker dock: thumb-sized targets, hero FOLIO key, live glow.
export default function MobileBottomNav() {
  const path = usePathname();
  const hasSession = useHasSession();
  const TABS = hasSession ? AUTH_TABS : GUEST_TABS;
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
          <div className="grid grid-cols-6">
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
