"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { symbols } from "@/app/components/symbols";
import { commoditySubtitle, useCommodities } from "@/app/hooks/useCommodities";
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
  { label: "News", href: "/news" },
  { label: "Commodities", href: "/commodities" },
];

// Ctrl+K fuzzy jump to scrips, pages, actions.
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const commodities = useCommodities();

  // Commodities first, then the equity master, de-duplicated by ticker.
  //
  // De-duplication matters: SILVER is both an MCX contract and an NSE ETF, so
  // without it the list shows the ticker twice and React sees two children with
  // the same key. The commodity wins because that is the instrument the rest of
  // the app resolves the symbol to.
  const universe = useMemo(() => {
    const seen = new Set<string>();
    const out: { Scrip: string; "Company Name": string }[] = [];
    for (const c of commodities) {
      const k = c.symbol.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ Scrip: k, "Company Name": commoditySubtitle(c) });
    }
    for (const s of symbols as { Scrip: string; "Company Name": string }[]) {
      const k = String(s.Scrip).toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ Scrip: k, "Company Name": String(s["Company Name"] || "") });
    }
    return out;
  }, [commodities]);

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
    ? universe
        .filter(
          (s) =>
            s.Scrip.includes(query) ||
            s["Company Name"].toUpperCase().includes(query),
        )
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
          {scrips.map((s) => (
            <button
              key={s.Scrip}
              onClick={() => go(`/stocks/${encodeURIComponent(s.Scrip)}`)}
              onMouseEnter={() => warmPrices(s.Scrip)}
              className="flex w-full items-baseline rounded-md px-4 py-2 text-left text-[13px] hover:bg-muted"
            >
              <span className="font-medium">{s.Scrip}</span>
              {s["Company Name"] ? (
                <span className="ml-2 truncate text-[11.5px] text-muted-foreground">
                  {s["Company Name"]}
                </span>
              ) : null}
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
