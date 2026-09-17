"use client";
import Link from "next/link";
import TopMovers from "../components/sections/TopMovers/TopMovers";
import { useSearchParams } from "next/navigation";
import { symbols } from "../components/symbols";
import { warmPrices } from "../lib/warmPrices";
import { Suspense, useEffect } from "react";
import SymbolSearch from "../components/SymbolSearch";
import { useLiveTicks } from "../hooks/useLiveTicks";

// The default list. Ten liquid large caps that exist in the instrument master
// *and* resolve on the live feed, so a visitor sees real prices immediately
// instead of an empty search box. (Tata Motors is listed as TMCV in the master,
// so it is deliberately not here.)
const FEATURED = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "LT",
  "AXISBANK",
  "WIPRO",
];

function companyOf(sym: string) {
  return symbols.find((s) => s.Scrip === sym)?.["Company Name"] || "";
}

function pct(ltp: number, close?: number) {
  if (!ltp || !close) return null;
  return ((ltp - close) / close) * 100;
}

// One row shape for both the featured list and search results.
function StockRow({
  symbol,
  name,
  price,
  changePct,
  live,
}: {
  symbol: string;
  name: string;
  price?: number;
  changePct?: number | null;
  live?: boolean;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <Link
      href={`/stocks/${encodeURIComponent(symbol)}`}
      onMouseEnter={() => warmPrices(symbol)}
      onFocus={() => warmPrices(symbol)}
      className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]"
    >
      <span className="min-w-0 font-mono text-[13px] font-semibold text-foreground">
        {symbol}
      </span>
      <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground sm:block">
        {name}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {price
          ? `₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
          : "—"}
      </span>
      <span
        className={`w-[64px] shrink-0 text-right font-mono text-[12px] tabular-nums ${
          changePct == null
            ? "text-muted-foreground"
            : up
              ? "text-positive"
              : "text-negative"
        }`}
      >
        {changePct == null
          ? live
            ? "·"
            : ""
          : `${up ? "+" : ""}${changePct.toFixed(2)}%`}
      </span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
      <span className="hidden text-[10.5px] text-muted-foreground/70 sm:block">
        LTP · DAY
      </span>
    </div>
  );
}

function FeaturedList() {
  const { ticks, live } = useLiveTicks(FEATURED, 5000);
  return (
    <div className="border border-border bg-card">
      <SectionLabel>Most followed</SectionLabel>
      <div className="divide-y divide-border">
        {FEATURED.map((sym) => {
          const t = ticks[sym];
          return (
            <StockRow
              key={sym}
              symbol={sym}
              name={companyOf(sym)}
              price={t?.ltp}
              changePct={pct(t?.ltp ?? 0, t?.close)}
              live={live}
            />
          );
        })}
      </div>
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const needle = query.toLowerCase();
  const hits = symbols
    .filter(
      (s) =>
        s["Company Name"].toLowerCase().includes(needle) ||
        s["Scrip"].toLowerCase().includes(needle),
    )
    .slice(0, 50);
  const { ticks } = useLiveTicks(
    hits.slice(0, 10).map((s) => s["Scrip"]),
    5000,
  );

  useEffect(() => {
    if (query.trim().length < 2) return;
    warmPrices(hits.slice(0, 5).map((s) => s["Scrip"]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (hits.length === 0)
    return (
      <div className="border border-border bg-muted px-6 py-10 font-mono text-sm">
        <div className="mb-1 text-muted-foreground">
          <span className="text-foreground/40">&gt; </span>
          NO MATCHES FOR &quot;{query.toUpperCase()}&quot;
        </div>
        <div className="text-foreground/40">TRY A DIFFERENT QUERY</div>
      </div>
    );

  return (
    <div className="border border-border bg-card">
      <SectionLabel>
        {hits.length} match{hits.length === 1 ? "" : "es"}
      </SectionLabel>
      <div className="divide-y divide-border">
        {hits.map((s) => {
          const t = ticks[s["Scrip"]];
          return (
            <StockRow
              key={s["Scrip"]}
              symbol={s["Scrip"]}
              name={s["Company Name"]}
              price={t?.ltp}
              changePct={pct(t?.ltp ?? 0, t?.close)}
            />
          );
        })}
      </div>
    </div>
  );
}

function StocksPage() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") || "";

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 mb-16">
      <div className="mx-auto max-w-7xl">
        {/* Compact header — one line, so the list starts above the fold. */}
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
            {searchQuery ? "Search results" : "Stocks"}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {searchQuery
              ? `Matching “${searchQuery}”`
              : `${symbols.length.toLocaleString("en-IN")} NSE scrips · live prices`}
          </p>
        </div>

        {/* One box for stocks and options. */}
        <div className="mb-5 max-w-2xl">
          <SymbolSearch />
        </div>

        <div className="mb-8">
          {searchQuery ? (
            <SearchResults query={searchQuery} />
          ) : (
            <FeaturedList />
          )}
        </div>

        <div className="mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            TOP MOVERS
          </span>
        </div>
        <TopMovers />
      </div>
    </div>
  );
}

export default function Stocks() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="skeleton h-6 w-32" />
          </div>
        </div>
      }
    >
      <StocksPage />
    </Suspense>
  );
}
