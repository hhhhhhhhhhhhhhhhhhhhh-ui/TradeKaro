"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { symbols } from "@/app/components/symbols";
import { getWLs } from "@/app/lib/watchlists";
import { warmPrices } from "@/app/lib/warmPrices";
import { FiStar } from "react-icons/fi";

const PAGES = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Orders", href: "/portfolio/orders" },
  { label: "Screener", href: "/screener" },
  { label: "Options", href: "/options" },
  { label: "Top Movers", href: "/topmovers" },
];

// Ctrl+K fuzzy jump to scrips, pages, actions.
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const query = q.trim().toUpperCase();
  const scrips = query
    ? symbols
        .filter((s: any) => String(s.Scrip).toUpperCase().includes(query))
        .slice(0, 8)
    : [];
  const wls = (() => {
    try {
      return getWLs().flatMap((w) => w.symbols);
    } catch {
      return [];
    }
  })();
  const pages = PAGES.filter(
    (p) => !query || p.label.toUpperCase().includes(query),
  );
  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-card border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type scrip or page… (ESC to close)"
          className="w-full rounded-md bg-transparent px-4 py-3 text-[14px] focus:outline-none"
        />
        <div className="max-h-80 overflow-auto py-2">
          {pages.map((p) => (
            <button
              key={p.href}
              onClick={() => go(p.href)}
              className="w-full rounded-md px-4 py-2 text-left text-[13px] hover:bg-muted"
            >
              → {p.label}
            </button>
          ))}
          {scrips.map((s: any) => (
            <button
              key={s.Scrip}
              onClick={() => go(`/stocks/${encodeURIComponent(s.Scrip)}`)}
              onMouseEnter={() => warmPrices(s.Scrip)}
              className="flex w-full rounded-md px-4 py-2 text-left text-[13px] hover:bg-muted"
            >
              <span>{s.Scrip}</span>
              {wls.includes(s.Scrip) ? (
                <FiStar
                  size={13}
                  aria-hidden
                  className="ml-2 shrink-0 text-positive"
                />
              ) : null}
            </button>
          ))}
          {!pages.length && !scrips.length ? (
            <div className="px-4 py-6 text-[13px] text-muted-foreground">
              No matches
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
