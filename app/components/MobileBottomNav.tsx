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

  // The affiliate surface and its landing pages bring their own navigation. The
  // trading dock on top of them would put two competing sets of tabs on one
  // screen and pull a visitor away from the one action the page is asking for.
  // Placed after every hook so the hook order stays identical on every route.
  if (path.startsWith("/partners") || path.startsWith("/l/")) return null;

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Full-bleed on purpose. This dock used to float as a 520px card with a
          gutter down each side, so on a phone it spent real width on empty
          margin and read as a widget parked on the page rather than the edge of
          the app. Edge to edge, all five targets share the whole width and the
          thumb never has to aim inward. */}
      <div className="pointer-events-auto w-full border-t border-border bg-card/95 pb-1.5 backdrop-blur-xl shadow-[0_-10px_34px_-14px_rgba(0,0,0,0.72)]">
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
                  className="relative flex min-h-[64px] flex-col items-center justify-end gap-1 pb-2 active:scale-95 transition-transform"
                >
                  {/* Raised with a TRANSFORM, not a margin. A negative margin
                      would lift the label with it and knock it off the
                      baseline the other four share; a translate moves the
                      keycap only, so it pokes above the bar while every label
                      still lines up. */}
                  <span
                    className={`flex h-12 w-12 -translate-y-3 items-center justify-center rounded-2xl transition-all ${
                      active
                        ? "bg-positive text-positive-foreground shadow-[0_12px_26px_-10px_rgba(38,166,154,0.9)]"
                        : "bg-foreground text-background shadow-[0_12px_24px_-12px_rgba(0,0,0,0.9)]"
                    }`}
                  >
                    <Icon size={21} strokeWidth={2.2} />
                  </span>
                  <span
                    className={`text-[10px] font-semibold tracking-[0.05em] ${
                      active ? "text-positive" : "text-foreground/60"
                    }`}
                  >
                    {label}
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="group relative flex min-h-[64px] flex-col items-center justify-end gap-1 pb-2 active:scale-95 transition-transform"
              >
                {/* One indicator, not two: a filled pill behind the icon and the
                    label taking the active colour. This replaces the old top
                    hairline, which sat under the browser's own chrome and was
                    easy to miss. */}
                <span
                  className={`relative flex h-8 w-[52px] items-center justify-center rounded-full transition-colors ${
                    active ? "bg-positive/12" : "group-hover:bg-muted/70"
                  }`}
                >
                  <Icon
                    size={20}
                    strokeWidth={active ? 2.4 : 1.8}
                    className={active ? "text-positive" : "text-foreground/55"}
                  />
                  {href === "/portfolio/orders" && pendingCount > 0 && (
                    <span className="absolute -top-1 right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-negative px-1 font-mono text-[10px] font-bold text-negative-foreground">
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </span>
                  )}
                  {href === "/watchlist" && active && (
                    <span className="absolute -right-0.5 top-0 h-2 w-2 rounded-full bg-positive animate-pulse" />
                  )}
                </span>
                <span
                  className={`text-[10px] font-semibold tracking-[0.05em] ${
                    active ? "text-positive" : "text-foreground/60"
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
