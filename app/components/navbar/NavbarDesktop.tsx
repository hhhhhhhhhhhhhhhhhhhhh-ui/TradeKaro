/* eslint-disable @next/next/no-img-element */
"use client";
import { getCookie } from "cookies-next";
import { useRouter } from "next/navigation";
import { CiSearch } from "react-icons/ci";
import { NavTransition } from "./NavTransition";
import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/app/components/theme/ThemeToggle";
import DensityToggle from "@/app/components/DensityToggle";
import parseJwt from "./utils/parseJwt";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { isMarketLive, marketStatusLabel } from "@/app/lib/marketClock";
import axios from "axios";
import { apiURL } from "@/app/components/apiURL";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Stocks", href: "/stocks" },
  { label: "Options", href: "/options" },
  { label: "Screener", href: "/screener" },
  { label: "Positions", href: "/positions" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Top Movers", href: "/topmovers" },
  { label: "Profile", href: "/profile" },
];

const RECENT_KEY = "fs_recent_searches";

export default function NavbarDesktop(props: any) {
  const [logStatus, setLogStatus] = useState(false);
  const [username, setUsername] = useState("");
  const [funds, setFunds] = useState<number | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const pathname = usePathname();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getCookie("token") as string | undefined;
    setLogStatus(!!token);
    if (token) {
      try {
        setUsername(parseJwt(token)?.username || "");
      } catch {
        /* ignore */
      }
    }
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"));
    } catch {
      setRecents([]);
    }
  }, [pathname]);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Funds pill: fetch remainingCash when logged in
  useEffect(() => {
    if (!logStatus) {
      setFunds(null);
      return;
    }
    const token = getCookie("token") as string | undefined;
    if (!token) return;
    let cancelled = false;
    axios({
      method: "post",
      url: apiURL + "/auth/getAccountDetails",
      headers: { Authorization: "Bearer " + token },
    })
      .then((r) => {
        if (cancelled) return;
        const cash = r.data?.remainingCash;
        if (typeof cash === "number") setFunds(cash);
      })
      .catch(() => {
        /* pill stays hidden on error */
      });
    return () => {
      cancelled = true;
    };
  }, [logStatus, pathname]);

  // Close avatar dropdown on outside click / Escape
  useEffect(() => {
    if (!avatarOpen) return;
    function onClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAvatarOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [avatarOpen]);

  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  async function handleSearch(e: any) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    try {
      const next = [
        q,
        ...recents.filter((r) => r.toLowerCase() !== q.toLowerCase()),
      ].slice(0, 5);
      setRecents(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setIsFocused(false);
    searchInputRef.current?.blur();
    router.push(`/stocks?search=${encodeURIComponent(q)}`);
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Session state comes from the shared clock, which reads the admin panel's
  // window and holidays. This badge used to hardcode 09:15–15:30, so it
  // disagreed with the status bar whenever an operator changed the hours.
  const { marketHours: navMarketHours } = usePublicConfig();
  const st = now
    ? {
        label: marketStatusLabel(navMarketHours, now),
        live: isMarketLive(navMarketHours, now),
      }
    : { label: "…", live: false };
  const { live: feedLive } = useLiveTicks(["NIFTY"], 8000);

  return (
    <header className="sticky top-0 z-40 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 bg-background/90 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto">
        {/* Tier 1 — main bar */}
        <div className="flex items-center flex-row justify-between py-3 gap-3">
          <NavTransition
            className="flex flex-row items-center shrink-0"
            href="/"
          >
            <img
              src="/TradeKaroLogo.png"
              alt="TradeKaro Logo"
              className="h-8 !rounded-md"
            />
            <span className="ml-2 font-medium text-foreground">TradeKaro</span>
          </NavTransition>
          <div className="flex flex-row items-center gap-2">
            {/* Market status pill */}
            <span
              title={feedLive ? "Data feed live" : "Data feed polling"}
              className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-[7px] text-[11px] font-medium text-foreground/70 xl:inline-flex"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${st.live ? "bg-positive live-dot" : "bg-negative"}`}
              />
              {st.label}
            </span>
            {/* Funds pill */}
            {logStatus && funds !== null && (
              <NavTransition
                href="/portfolio"
                className="hidden h-[34px] items-center rounded-md border border-border px-3 font-mono text-[11px] tabular-nums text-foreground/80 transition hover:border-foreground lg:inline-flex"
              >
                ₹{funds.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </NavTransition>
            )}
            <div
              className={`relative flex h-[34px] w-[220px] flex-row items-center rounded-full border px-3 transition lg:w-[320px] ${isFocused ? "border-foreground" : "border-border hover:border-foreground"}`}
            >
              <form
                className="flex flex-row items-center justify-center h-full w-full"
                onSubmit={handleSearch}
              >
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setTimeout(() => setIsFocused(false), 120)}
                  className="h-full min-w-0 flex-1 border-none bg-transparent px-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-none focus:outline-none"
                  type="text"
                  placeholder="Search stocks"
                />
                <span className="mr-1.5 hidden shrink-0 items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground/40 lg:inline-flex">
                  ⌘K
                </span>
                <button
                  type="submit"
                  className="my-auto shrink-0"
                  aria-label="Search"
                >
                  <CiSearch className="hover:text-brand text-base text-foreground" />
                </button>
              </form>
              {isFocused && !query && recents.length > 0 && (
                <div className="absolute left-0 right-0 top-[38px] z-50 rounded-lg border border-border bg-card shadow-lg">
                  <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent
                  </div>
                  {recents.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQuery(r);
                        router.push(`/stocks?search=${encodeURIComponent(r)}`);
                      }}
                      className="block w-full truncate rounded-md px-3 py-2 text-left text-[13px] text-foreground/80 hover:bg-muted"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ThemeToggle />
            <DensityToggle />
            {!logStatus && (
              <NavTransition href="/signup" className="flex">
                <button
                  type="button"
                  className="flex h-[34px] items-center justify-center rounded-md border border-foreground bg-foreground px-4 text-[12px] font-semibold text-background transition hover:bg-foreground/90"
                >
                  SIGN UP
                </button>
              </NavTransition>
            )}
            {logStatus && (
              <div ref={avatarRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAvatarOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={avatarOpen}
                  title={username || "Account"}
                  className="pressable flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-muted text-[12px] font-semibold text-foreground"
                >
                  {(username?.[0] || "U").toUpperCase()}
                </button>
                {avatarOpen && (
                  <div className="absolute right-0 top-[40px] z-50 w-48 rounded-lg border border-border bg-card shadow-lg">
                    <div className="truncate border-b border-border px-4 py-2.5 text-[12px] text-muted-foreground">
                      {username || "Account"}
                    </div>
                    {[
                      { label: "Profile", href: "/profile" },
                      { label: "Portfolio", href: "/portfolio" },
                      { label: "Orders", href: "/portfolio/orders" },
                      { label: "Funds", href: "/portfolio" },
                      { label: "Ledger", href: "/ledger" },
                      { label: "Settings", href: "/settings" },
                      { label: "Watchlist", href: "/watchlist" },
                      { label: "Log out", href: "/logout" },
                    ].map((o) => (
                      <NavTransition
                        key={o.label + o.href}
                        href={o.href}
                        className="block px-4 py-2 text-[13px] text-foreground/80 transition hover:bg-muted"
                      >
                        {o.label}
                      </NavTransition>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Tier 2 — nav links */}
        <nav
          className="flex items-center gap-1 overflow-x-auto pb-2 -mb-px"
          aria-label="Primary"
        >
          {NAV_LINKS.map((l) => {
            const active =
              pathname === l.href ||
              (l.href !== "/" && pathname?.startsWith(l.href));
            return (
              <NavTransition
                key={l.href}
                href={l.href}
                className={`pressable relative shrink-0 px-3 py-2 text-[12.5px] font-medium transition ${active ? "text-foreground" : "text-foreground/55 hover:text-foreground"}`}
              >
                {l.label}
                <span
                  className={`absolute inset-x-3 bottom-0 h-0.5 bg-foreground transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                />
              </NavTransition>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
