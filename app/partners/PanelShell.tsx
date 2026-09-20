"use client";

// The affiliate panel shell: sidebar on desktop, sticky header + bottom dock on
// mobile. Mirrors the trading app's full-bleed dock (2 items · hero · 2 items)
// so a partner who also trades recognises the product, but every destination is
// a partner destination.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  FiBarChart2,
  FiChevronRight,
  FiCopy,
  FiCreditCard,
  FiExternalLink,
  FiGrid,
  FiLink2,
  FiLogOut,
  FiPieChart,
  FiSettings,
  FiUsers,
  FiCheck,
  FiX,
} from "react-icons/fi";
import { copyText } from "./lib/api";
import { usePartner } from "./lib/store";

type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: ReactNode;
};

const nav = (size = 18): NavItem[] => [
  {
    href: "/partners/dashboard",
    label: "Dashboard",
    short: "Home",
    icon: <FiGrid size={size} />,
  },
  {
    href: "/partners/links",
    label: "Links",
    short: "Links",
    icon: <FiLink2 size={size} />,
  },
  {
    href: "/partners/stats",
    label: "Statistics",
    short: "Stats",
    icon: <FiBarChart2 size={size} />,
  },
  {
    href: "/partners/referrals",
    label: "Referrals",
    short: "Referrals",
    icon: <FiUsers size={size} />,
  },
  {
    href: "/partners/earnings",
    label: "Earnings",
    short: "Earnings",
    icon: <FiPieChart size={size} />,
  },
  {
    href: "/partners/payouts",
    label: "Payouts",
    short: "Payouts",
    icon: <FiCreditCard size={size} />,
  },
];

/** 2 on the left, hero in the centre, 2 on the right — the trading app's rule. */
const DOCK: {
  key: string;
  href: string;
  label: string;
  hero?: boolean;
  icon: ReactNode;
}[] = [
  {
    key: "dashboard",
    href: "/partners/dashboard",
    label: "Home",
    icon: <FiGrid size={19} />,
  },
  {
    key: "stats",
    href: "/partners/stats",
    label: "Stats",
    icon: <FiBarChart2 size={19} />,
  },
  {
    key: "links",
    href: "/partners/links",
    label: "Links",
    hero: true,
    icon: <FiLink2 size={22} />,
  },
  {
    key: "earnings",
    href: "/partners/earnings",
    label: "Earnings",
    icon: <FiPieChart size={19} />,
  },
  {
    key: "payouts",
    href: "/partners/payouts",
    label: "Payout",
    icon: <FiCreditCard size={19} />,
  },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/partners/dashboard"
      className="group flex items-center gap-2.5"
      aria-label="TradeStox Partners"
    >
      <span className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[13px] font-black text-white shadow-sm">
        TS
      </span>
      {!compact ? (
        <span className="leading-none">
          <span className="block text-[13.5px] font-semibold tracking-tight text-foreground">
            TradeStox
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
            Partners
          </span>
        </span>
      ) : null}
    </Link>
  );
}

export default function PanelShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, toast } = usePartner();
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close the profile sheet on navigation. Without this it survives a route
  // change and hides the page the partner just asked for.
  useEffect(() => setSheet(false), [pathname]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const code = me?.affiliate.code || "";
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  async function copyCode() {
    if (!code) return;
    const ok = await copyText(code);
    setCopied(ok);
    if (ok) {
      toast("Referral code copied", "ok");
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast("Could not copy — long-press to select", "err");
    }
  }

  const items = nav();

  return (
    <div className="min-h-dvh bg-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-border bg-card/60 backdrop-blur-xl lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>

        <div className="mx-4 rounded-xl border border-border bg-muted/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Your code
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="pressable mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left"
          >
            <span className="display-num text-[13px] font-semibold text-foreground">
              {code || "—"}
            </span>
            {copied ? (
              <FiCheck size={13} className="text-positive" />
            ) : (
              <FiCopy size={13} className="text-muted-foreground" />
            )}
          </button>
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`pressable flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-brand/10 text-brand"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <span
                  className={active ? "text-brand" : "text-muted-foreground/80"}
                >
                  {n.icon}
                </span>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border/60 p-3">
          <div className="mb-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Available now
            </div>
            <div className="display-num mt-1 text-[17px] font-semibold text-positive">
              ₹{(me?.summary.available ?? 0).toLocaleString("en-IN")}
            </div>
            {(me?.summary.pending ?? 0) > 0 ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                ₹{me!.summary.pending.toLocaleString("en-IN")} in holdback
              </div>
            ) : null}
          </div>
          <Link
            href="/partners/profile"
            className={`pressable flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
              isActive("/partners/profile")
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            <FiSettings size={18} />
            Account
          </Link>
        </div>
      </aside>

      {/* ── Mobile header ───────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur-xl lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <Brand />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyCode}
              className="pressable flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1.5"
              aria-label="Copy referral code"
            >
              <span className="display-num text-[11.5px] font-semibold text-foreground">
                {code || "—"}
              </span>
              {copied ? (
                <FiCheck size={12} className="text-positive" />
              ) : (
                <FiCopy size={12} className="text-muted-foreground" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="pressable grid h-9 w-9 place-items-center rounded-full brand-gradient text-[12px] font-bold text-white"
              aria-label="Open account menu"
            >
              {(me?.affiliate.name || "P").slice(0, 1).toUpperCase()}
            </button>
          </div>
        </div>
        <div className="h-[2px] w-full brand-gradient" />
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="lg:pl-[236px]">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-8">
          {children}
        </div>
      </main>

      {/* ── Mobile dock: 2 · hero · 2 ───────────────────────────────────── */}
      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="pointer-events-auto w-full border-t border-border bg-card/95 pb-1.5 shadow-[0_-10px_34px_-14px_rgba(0,0,0,0.72)] backdrop-blur-xl">
          <div className="h-[2px] w-full brand-gradient" />
          <div className="grid grid-cols-5">
            {DOCK.map((d) => {
              const active = isActive(d.href);
              if (d.hero)
                return (
                  <Link
                    key={d.key}
                    href={d.href}
                    className="pressable flex min-h-[64px] flex-col items-center justify-end gap-1 pb-2"
                    aria-label={d.label}
                  >
                    <span
                      className={`grid h-12 w-12 -translate-y-3 place-items-center rounded-2xl shadow-lg transition-colors ${
                        active
                          ? "brand-gradient text-white"
                          : "bg-card text-brand ring-1 ring-brand/25"
                      }`}
                    >
                      {d.icon}
                    </span>
                    <span
                      className={`text-[10px] font-semibold leading-none ${
                        active ? "text-brand" : "text-muted-foreground"
                      }`}
                    >
                      {d.label}
                    </span>
                  </Link>
                );
              return (
                <Link
                  key={d.key}
                  href={d.href}
                  className="pressable group relative flex min-h-[64px] flex-col items-center justify-end gap-1 pb-2"
                >
                  <span
                    className={`grid h-8 w-[52px] place-items-center rounded-full transition-colors ${
                      active
                        ? "bg-brand/12 text-brand"
                        : "text-muted-foreground"
                    }`}
                  >
                    {d.icon}
                  </span>
                  <span
                    className={`text-[10px] font-semibold leading-none ${
                      active ? "text-brand" : "text-muted-foreground"
                    }`}
                  >
                    {d.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ── Account sheet ───────────────────────────────────────────────── */}
      {sheet ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheet(false)}
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card pb-[calc(env(safe-area-inset-bottom,0px)+10px)] shadow-2xl"
            style={{ animation: "sheet-up 180ms cubic-bezier(0.22,1,0.36,1)" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-foreground">
                  {me?.affiliate.name || "Partner"}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {me?.affiliate.email}
                </div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand">
                  {me?.affiliate.planName} · {me?.affiliate.modelLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="pressable grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
                aria-label="Close"
              >
                <FiX size={15} />
              </button>
            </div>

            <div className="p-2">
              <SheetLink
                href="/partners/referrals"
                icon={<FiUsers size={17} />}
                label="Referrals"
                hint={`${me?.summary.customers ?? 0} customers`}
              />
              <SheetLink
                href="/partners/profile"
                icon={<FiSettings size={17} />}
                label="Account & payout details"
              />
              <SheetLink
                href="/partners/payouts"
                icon={<FiCreditCard size={17} />}
                label="Payouts"
                hint={`₹${(me?.summary.available ?? 0).toLocaleString("en-IN")} available`}
              />
            </div>

            <div className="border-t border-border/60 p-2">
              <Link
                href="/dashboard"
                className="pressable flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted-foreground"
              >
                <FiExternalLink size={17} />
                Open trading terminal
              </Link>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/partners/logout", {
                    method: "POST",
                    credentials: "same-origin",
                  });
                  window.location.href = "/partners/login";
                }}
                className="pressable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-negative"
              >
                <FiLogOut size={17} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SheetLink({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="pressable flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-foreground hover:bg-muted/50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
      <FiChevronRight size={14} className="text-muted-foreground/60" />
    </Link>
  );
}
