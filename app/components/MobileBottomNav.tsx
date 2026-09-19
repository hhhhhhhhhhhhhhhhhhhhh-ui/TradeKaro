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
  FiActivity,
  FiFilter,
  FiBarChart2,
  FiBox,
  FiCreditCard,
} from "react-icons/fi";

// Signed-in dock: five thumbs in the thumb zone, and POSITIONS dead centre as
// the raised hero key.
//
// The centre slot is not decoration — it is the one screen a trader opens
// constantly (live P&L on what they are holding), and the middle is where the
// thumb lands without looking. The four around it are the rest of the day loop:
// find something to trade (LIST), see what you have done (ORDERS), see what you
// can trade (OPTS), move the money (WALLET).
//
// PROFILE was removed from this dock. It was a sixth key that pushed everything
// off-centre, and it is not a trading surface — it now lives on the header
// avatar, where "who am I / settings" belongs. That also removes the last
// destination offered in two places at once.
const AUTH_TABS = [
  { href: "/watchlist", label: "LIST", Icon: FiStar },
  { href: "/portfolio/orders", label: "ORDERS", Icon: FiClipboard },
  { href: "/positions", label: "POSITION", Icon: FiBriefcase, hero: true },
  { href: "/wallet", label: "WALLET", Icon: FiCreditCard },
  { href: "/options", label: "OPTS", Icon: FiTrendingUp },
];

// Visitor dock. Same five-key shape and the same centred hero, because a
// visitor has no drawer at all — this dock IS their navigation, so the layout
// has to carry itself. The centre is the market list they came for: discovery
// on the left, the core market page in the middle, the asset classes on the
// right.
//
// LOGIN is deliberately gone from here. It was the sixth key and it duplicated
// the LOGIN button already pinned in the header, so a visitor was offered the
// same destination twice on one screen — the exact clutter this dock now
// avoids. Login is still one tap away, in a place they can always see.
//
// The column class is a literal per list, never `grid-cols-${n}`: a dynamic
// name would not survive Tailwind's build-time scan.
const GUEST_TABS = [
  { href: "/screener", label: "SCREEN", Icon: FiFilter },
  { href: "/topmovers", label: "MOVERS", Icon: FiBarChart2 },
  { href: "/stocks", label: "STOCKS", Icon: FiTrendingUp, hero: true },
  { href: "/options", label: "OPTS", Icon: FiActivity },
  { href: "/commodities", label: "COMMOD", Icon: FiBox },
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
          <div
            className={
              TABS.length === 5 ? "grid grid-cols-5" : "grid grid-cols-6"
            }
          >
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
