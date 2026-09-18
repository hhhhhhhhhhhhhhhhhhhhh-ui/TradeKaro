"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { FiChevronDown, FiSearch } from "react-icons/fi";
import Loading from "@/app/components/Loading";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import useHasSession from "@/app/hooks/useHasSession";
import { money, num, pctSigned } from "@/app/lib/format";
import { getBackendCash, getWalletBalance } from "@/app/lib/trading";
import { istYmd, marketStatusLabel } from "@/app/lib/marketClock";
import {
  familyLabel,
  familyOf,
  packLabel,
  unitLabel,
} from "@/app/lib/commodityUnits";

// The MCX contract ladder.
//
// This page exists because the affordability problem is mostly a DISCOVERY
// problem. MCX lists several contracts per commodity at wildly different sizes —
// gold alone comes as 1 g, 8 g, 10 g, 100 g and 1 kg — and a screen that only
// offers "GOLD" is really only offering the 1 kg contract, which needs about
// ₹7.65 lakh of margin. Real retail traders pick a rung on this ladder; nothing
// stopped anyone here except not being able to see it.
//
// Sorted by the margin needed to get in, so the answer to "what can I actually
// trade" is the top row.

/** Reference data for one contract. Changes at most daily. */
type Meta = {
  symbol: string;
  /** The root, e.g. GOLD for GOLD27FEBFUT. */
  root: string;
  lot: number;
  /** Rupees, already converted from the master's paise by the API. */
  tick: number;
  expiry: string;
  segment: string;
};

type Row = Meta & {
  family: string;
  pack: string | null;
  unit: string | null;
  ltp: number;
  chg: number | null;
  spread: number | null;
  oi: number;
  vol: number;
  lotValue: number;
  unitMargin: number;
  lotMargin: number;
  days: number | null;
  quoted: boolean;
};

type SortKey = "entry" | "change" | "lot";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "entry", label: "Entry cost" },
  { key: "change", label: "Biggest move" },
  { key: "lot", label: "Lot value" },
];

/**
 * Days from today to an expiry date, counted in IST.
 *
 * Both sides are normalised to UTC midnight before subtracting, so the answer
 * cannot shift by a day depending on the viewer's timezone or the hour they
 * open the page — an expiry is a date, not an instant.
 */
function daysUntil(expiry: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry || ""));
  if (!m) return null;
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(istYmd(new Date()));
  if (!t) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(+t[1], +t[2] - 1, +t[3]);
  return Math.round((target - today) / 864e5);
}

function compare(a: Row, b: Row, sort: SortKey): number {
  // A contract with no price sorts last under every ordering. It stays on the
  // page — hiding it is what made the original bug invisible — but it cannot be
  // ranked against rows that have a number.
  if (a.quoted !== b.quoted) return a.quoted ? -1 : 1;
  if (sort === "change") return Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0);
  if (sort === "lot") return a.lotValue - b.lotValue;
  return a.unitMargin - b.unitMargin;
}

export default function CommoditiesPage() {
  const cfg = usePublicConfig();
  const marginPct = Number(cfg.trading?.marginPct) || 5;
  const fractional = cfg.trading?.fractionalLots !== false;
  const hasSession = useHasSession();

  const [meta, setMeta] = useState<Meta[] | null>(null);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("entry");
  const [budget, setBudget] = useState("");
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [wallet, setWallet] = useState<number | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Reference data only. What a symbol IS changes at most daily; what it COSTS
  // comes from the shared tick store below.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get("/api/market/instrument?all=commodities");
        const items: any[] = r.data?.items || [];
        const built: Meta[] = items
          .filter((i) => i?.symbol && i?.contract)
          .map((i) => ({
            symbol: String(i.symbol).toUpperCase(),
            root: String(i.contract.name || i.symbol).toUpperCase(),
            lot: Number(i.contract.lot) || 1,
            tick: Number(i.contract.tick) || 0,
            expiry: String(i.contract.expiry || ""),
            segment: String(i.segment || "MCX"),
          }));
        if (!alive) return;
        if (!built.length) {
          setNote("The instrument list could not be loaded.");
          setMeta([]);
          return;
        }
        setMeta(built);
      } catch {
        if (alive) {
          setNote("Could not reach the market data provider.");
          setMeta([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const symbols = useMemo(() => (meta || []).map((m) => m.symbol), [meta]);

  // Every contract on this page, on the live socket.
  //
  // This page used to POST /api/market/quote once on mount and never again, so a
  // price was frozen at whatever it was when the tab opened — the delay was
  // however long the tab had been open, while the footnote called them live.
  // useLiveTicks runs the shared poller, attaches to the SSE stream and chunks
  // the union into ≤10-symbol quote calls internally, so this also removes the
  // hand-rolled chunking that existed only because the quote route caps at ten
  // and drops the rest silently.
  const { ticks, live } = useLiveTicks(symbols, 5000);

  // The wallet, for a signed-in visitor only. Read after mount because it comes
  // from localStorage — touching it during render would desync hydration.
  useEffect(() => {
    if (!hasSession) {
      setWallet(null);
      return;
    }
    setWallet(getWalletBalance(getBackendCash()));
  }, [hasSession]);

  // The clock, for the session badge. Refreshed on a timer rather than read
  // during render, for the same hydration reason.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo<Row[]>(() => {
    return (meta || []).map((m) => {
      const t = ticks[m.symbol];
      const ltp = Number(t?.ltp) || 0;
      const close = Number(t?.close) || 0;
      const bid = Number(t?.depth?.buy?.[0]?.price) || 0;
      const ask = Number(t?.depth?.sell?.[0]?.price) || 0;
      return {
        ...m,
        family: familyOf(m.root),
        pack: packLabel(m.root, m.lot),
        unit: unitLabel(m.root),
        ltp,
        // Day change needs the previous close, which both the socket and the
        // REST snapshot carry. Without it this ladder had no direction at all:
        // a commodity up 4% looked exactly like one that had not moved.
        chg: close > 0 && ltp > 0 ? ((ltp - close) / close) * 100 : null,
        spread: bid > 0 && ask >= bid ? ask - bid : null,
        oi: Number(t?.oi) || 0,
        vol: Number(t?.volume) || 0,
        lotValue: ltp * m.lot,
        unitMargin: (ltp * marginPct) / 100,
        lotMargin: (ltp * m.lot * marginPct) / 100,
        days: daysUntil(m.expiry),
        quoted: ltp > 0,
      };
    });
  }, [meta, ticks, marginPct]);

  // An empty budget means "my balance", so the default question this page
  // answers is the one that matters: what can I trade with the money I have.
  const cap = useMemo(() => {
    const typed = Number(budget);
    if (budget.trim() && Number.isFinite(typed) && typed > 0) return typed;
    return wallet && wallet > 0 ? wallet : null;
  }, [budget, wallet]);

  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let out = rows.filter(
      (r) =>
        !needle ||
        r.symbol.includes(needle) ||
        r.root.includes(needle) ||
        r.family.includes(needle) ||
        familyLabel(r.family).toUpperCase().includes(needle),
    );
    if (onlyAffordable && cap != null)
      out = out.filter((r) => r.quoted && r.unitMargin <= cap);
    return out;
  }, [rows, q, onlyAffordable, cap]);

  // One group per commodity. Roots arrive as separate contracts — GOLD, GOLDM,
  // GOLD10G and four more are seven rows describing one metal — and a flat list
  // of 33 reads as 33 unrelated things.
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of list) {
      const arr = map.get(r.family);
      if (arr) arr.push(r);
      else map.set(r.family, [r]);
    }
    const out = [...map.entries()].map(([family, rs]) => ({
      family,
      rows: [...rs].sort((a, b) => compare(a, b, sort)),
    }));
    out.sort((a, b) => compare(a.rows[0], b.rows[0], sort));
    return out;
  }, [list, sort]);

  const quotedCount = rows.filter((r) => r.quoted).length;
  const missing = rows.length - quotedCount;
  const fits =
    cap != null
      ? rows.filter((r) => r.quoted && r.unitMargin <= cap).length
      : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Commodities (MCX)
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Every commodity contract on MCX, grouped by commodity and cheapest
            first. Each commodity is listed in several sizes — gold alone runs
            from 1&nbsp;gram to 1&nbsp;kilogram — so pick the rung that fits
            your balance.
            {fractional ? " Orders can also be placed in single units." : ""}
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
          {now ? (
            // MCX specifically, not the equity clock: cash shuts at 15:30 and
            // these contracts trade to 23:30, so the NSE label would tell a gold
            // holder the market was closed while their order was filling.
            <span className="rounded-full border border-border px-2.5 py-1 font-medium">
              {marketStatusLabel(cfg.marketHours, now, "MCX", cfg.calendar)}
            </span>
          ) : null}
          <span className={live ? "text-positive" : ""}>
            {live ? "feed live" : "feed delayed"}
          </span>
          <span>
            {quotedCount} of {rows.length} priced
          </span>
          {fits != null && cap != null ? (
            <span>
              {fits} start under {money(cap, 0)}
            </span>
          ) : null}
          {missing > 0 ? (
            <span className="text-negative">
              {missing} with no live quote — listed, not hidden
            </span>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative flex h-[34px] min-w-[190px] flex-1 items-center rounded-full border border-border px-3">
            <FiSearch
              className="mr-2 shrink-0 text-muted-foreground"
              size={14}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter — gold, silver, crude…"
              aria-label="Filter contracts"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="flex h-[34px] items-center rounded-full border border-border p-0.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  sort === s.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="flex h-[34px] items-center gap-2 rounded-full border border-border px-3">
            <span className="text-[11.5px] text-muted-foreground">
              Budget ₹
            </span>
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder={wallet ? String(Math.round(wallet)) : "any"}
              aria-label="Budget"
              className="w-[72px] bg-transparent text-[12.5px] tabular-nums outline-none placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-full border border-border px-3">
            <input
              type="checkbox"
              checked={onlyAffordable}
              onChange={(e) => setOnlyAffordable(e.target.checked)}
            />
            <span className="text-[11.5px]">Only what fits</span>
          </label>
        </div>

        {meta === null ? (
          <div className="py-16 flex justify-center">
            <Loading />
          </div>
        ) : !rows.length ? (
          <div className="broker-card px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            {note || "No commodity contracts available right now."}
          </div>
        ) : !groups.length ? (
          <div className="broker-card px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            No contract matches that filter.
          </div>
        ) : (
          <div className="broker-card overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Contract</th>
                  <th className="px-4 py-2.5 text-right font-semibold">LTP</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Chg</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Lot</th>
                  {/* The entry cost drives the sort, and a column that orders
                      the table while sitting off-screen makes it look
                      arbitrarily shuffled. */}
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Entry (1 unit)
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Whole lot
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">OI</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const many = g.rows.length > 1;
                  const open = !collapsed[g.family];
                  const best = g.rows[0];
                  return (
                    <Fragment key={g.family}>
                      {many ? (
                        <tr className="border-b border-border/60 bg-muted/40">
                          <td colSpan={8} className="px-4 py-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsed((c) => ({
                                  ...c,
                                  [g.family]: !c[g.family],
                                }))
                              }
                              aria-expanded={open}
                              className="flex w-full items-center gap-2 text-left"
                            >
                              <FiChevronDown
                                size={13}
                                className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                              />
                              <span className="text-[11.5px] font-semibold uppercase tracking-wide">
                                {familyLabel(g.family)}
                              </span>
                              <span className="text-[11px] font-normal text-muted-foreground">
                                {g.rows.length} contracts
                                {best.quoted
                                  ? ` · from ${money(best.unitMargin, 0)}`
                                  : ""}
                              </span>
                            </button>
                          </td>
                        </tr>
                      ) : null}
                      {!many || open
                        ? g.rows.map((r) => (
                            <tr
                              key={r.symbol}
                              className="border-b border-border/60 last:border-b-0 hover:bg-muted/60"
                            >
                              <Cells r={r} cap={cap} />
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground/80">
          Prices are live. Sorted by what it costs to get in, cheapest first.
          Margin is shown at {marginPct}% of contract value, the platform-wide
          setting. Real MCX margins are SPAN + ELM and typically higher, and
          they rise further near expiry — so treat these as a floor, not a
          quote.
        </p>
      </div>
    </div>
  );
}

/**
 * One contract's cells.
 *
 * Kept as a separate component because a group renders its rows inline and the
 * table body would otherwise be unreadable — and because the afford styling has
 * to be identical in a grouped and an ungrouped row.
 */
function Cells({ r, cap }: { r: Row; cap: number | null }) {
  const over = cap != null && r.quoted && r.unitMargin > cap;
  const up = (r.chg ?? 0) >= 0;
  const soon = r.days != null && r.days <= 5;
  return (
    <>
      <td className="px-4 py-2.5 align-top">
        <div className="font-medium">{r.symbol}</div>
        {r.pack ? (
          <div className="text-[10.5px] text-muted-foreground">
            {r.pack}
            {r.unit ? ` · priced per ${r.unit}` : ""}
          </div>
        ) : null}
        <div className="text-[10.5px] text-muted-foreground">
          {r.expiry ? `exp ${r.expiry}` : "—"}
          {r.days != null ? (
            <span className={soon ? "text-negative" : ""}>
              {" "}
              · {r.days < 0 ? "expired" : `${r.days}d left`}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums">
        {r.quoted ? (
          money(r.ltp, 2)
        ) : (
          <span className="text-muted-foreground">no quote</span>
        )}
        {r.spread != null ? (
          <div className="text-[10.5px] text-muted-foreground">
            spread {money(r.spread, 2)}
          </div>
        ) : null}
      </td>
      <td
        className={`px-4 py-2.5 text-right align-top font-mono tabular-nums ${
          r.chg == null
            ? "text-muted-foreground"
            : up
              ? "text-positive"
              : "text-negative"
        }`}
      >
        {r.chg == null ? "—" : pctSigned(r.chg, 2)}
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums text-muted-foreground">
        {num(r.lot)}
        {r.tick > 0 ? (
          <div className="text-[10.5px]">tick {money(r.tick, 2)}</div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums">
        <span className={over ? "opacity-40" : ""}>
          {r.quoted ? money(r.unitMargin, 0) : "—"}
        </span>
        {over ? (
          <div className="text-[10px] text-muted-foreground">over budget</div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums">
        {r.quoted ? money(r.lotValue, 0) : "—"}
        <div className="text-[10.5px] text-muted-foreground">
          {r.quoted ? `${money(r.lotMargin, 0)} margin` : ""}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono tabular-nums text-muted-foreground">
        {r.oi > 0 ? num(r.oi) : "—"}
        {r.vol > 0 ? (
          <div className="text-[10.5px]">vol {num(r.vol)}</div>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        <Link
          href={`/stocks/${r.symbol}`}
          className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-muted"
        >
          Trade
        </Link>
      </td>
    </>
  );
}
