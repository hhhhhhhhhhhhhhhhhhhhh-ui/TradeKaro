"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import Loading from "@/app/components/Loading";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import { money } from "@/app/lib/format";

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

type Row = {
  symbol: string;
  lot: number;
  expiry: string;
  ltp: number;
};

export default function CommoditiesPage() {
  const cfg = usePublicConfig();
  const marginPct = Number(cfg.trading?.marginPct) || 5;
  const fractional = cfg.trading?.fractionalLots !== false;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await axios.get("/api/market/instrument?all=commodities");
        const items: any[] = meta.data?.items || [];
        const symbols = items
          .filter((i) => i.symbol && i.contract)
          .map((i) => i.symbol);
        if (!symbols.length) {
          if (alive) {
            setNote("The instrument list could not be loaded.");
            setLoading(false);
          }
          return;
        }
        // Ten at a time. The quote endpoint caps a request at ten symbols (and so
        // does the provider's batch call), and it drops the rest SILENTLY rather
        // than erroring — so asking for all 33 in one go rendered a ladder of the
        // first eight alphabetically, with GOLD missing and nothing to say why.
        const CHUNK = 10;
        const chunks: string[][] = [];
        for (let i = 0; i < symbols.length; i += CHUNK)
          chunks.push(symbols.slice(i, i + CHUNK));
        const responses = await Promise.all(
          chunks.map((c) =>
            axios.post("/api/market/quote", { symbols: c }).catch(() => null),
          ),
        );
        const px: Record<string, number> = {};
        for (const resp of responses)
          for (const t of resp?.data?.ticks || []) px[t.symbol] = Number(t.ltp);
        const built: Row[] = items
          .filter((i) => i.contract && Number(px[i.symbol]) > 0)
          .map((i) => ({
            symbol: i.symbol,
            lot: Number(i.contract.lot) || 1,
            expiry: String(i.contract.expiry || ""),
            ltp: px[i.symbol],
          }));
        if (alive) setRows(built);
      } catch {
        if (alive) setNote("Could not reach the market data provider.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const unitMargin = (r: Row) => (r.ltp * marginPct) / 100;
  const lotMargin = (r: Row) => (r.lot * r.ltp * marginPct) / 100;

  // Cheapest ENTRY first, not cheapest lot value — the entry cost is what decides
  // whether a contract is reachable, and it is the question this page answers.
  const byUnit = useMemo(
    () => [...rows].sort((a, b) => unitMargin(a) - unitMargin(b)),
    [rows, marginPct],
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Commodities (MCX)
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Every commodity contract on MCX, smallest first. Each commodity is
            listed in several sizes — gold alone runs from 1&nbsp;gram to
            1&nbsp;kilogram — so pick the rung that fits your balance.
            {fractional ? " Orders can also be placed in single units." : ""}
          </p>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loading />
          </div>
        ) : !byUnit.length ? (
          <div className="broker-card px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            {note || "No commodity contracts available right now."}
          </div>
        ) : (
          <div className="broker-card overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Contract</th>
                  <th className="px-4 py-2.5 text-right font-semibold">LTP</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Lot</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Lot value
                  </th>
                  {/* The entry cost comes first because it is the sort key: the
                      table is ordered by what it costs to get in, and a column
                      that drives the order while sitting off-screen makes the
                      whole table look arbitrarily shuffled. */}
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Entry (1 unit)
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Whole lot
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {byUnit.map((r) => (
                  <tr
                    key={r.symbol}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/60"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.symbol}</div>
                      <div className="text-[10.5px] text-muted-foreground">
                        expires {r.expiry}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {money(r.ltp, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {r.lot}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {money(r.lot * r.ltp, 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {money(unitMargin(r), 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {money(lotMargin(r), 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/stocks/${r.symbol}`}
                        className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-muted"
                      >
                        Trade
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground/80">
          Sorted by what it costs to get in, cheapest first. Margin is shown at{" "}
          {marginPct}% of contract value, the platform-wide setting. Real MCX
          margins are SPAN + ELM and typically higher, and they rise further
          near expiry — so treat these as a floor, not a quote. Prices are live
          and indicative.
        </p>
      </div>
    </div>
  );
}
