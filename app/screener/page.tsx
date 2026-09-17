"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { apiURL } from "@/app/components/apiURL";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import Loading from "@/app/components/Loading";
import { FiSearch } from "react-icons/fi";

// Day-change + volume screener over the top-movers universe.
export default function ScreenerPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [minChg, setMinChg] = useState(2);
  const [onlyGainers, setOnlyGainers] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const d = await axios.post(`${apiURL}/topmovers`, { size: 50 });
        // /api/v1/topmovers returns { TOP_GAINERS:{items:[{company,stats}]}, ... }
        // (shape inherited from the retired worker so old callers keep working)
        // Normalize to flat rows the table expects.
        const raw: any[] = [
          ...(d.data?.TOP_GAINERS?.items || []),
          ...(d.data?.TOP_LOSERS?.items || []),
          ...(d.data?.TOP_VOLUME?.items || []),
        ];
        const flat = raw.map((it: any) => ({
          symbol:
            it.symbol ||
            it.company?.nseScriptCode ||
            it.company?.bseScriptCode ||
            it.nseScriptCode ||
            "",
          companyName: it.company?.companyName || it.companyName || "",
          ltp: Number(it.ltp ?? it.stats?.ltp ?? it.lastPrice ?? 0),
          dayChangePerc: Number(
            it.dayChangePerc ?? it.stats?.dayChangePerc ?? it.pChange ?? 0,
          ),
          volume: Number(
            it.volume ?? it.stats?.volume ?? it.totalTradedVolume ?? 0,
          ),
        }));
        const seen = new Map();
        for (const it of flat)
          if (it.symbol && !seen.has(it.symbol)) seen.set(it.symbol, it);
        setRows(Array.from(seen.values()));
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const out = rows
    .filter((r) => {
      const chg = Number(r.dayChangePerc ?? r.pChange ?? 0);
      if (onlyGainers && chg < minChg) return false;
      if (!onlyGainers && Math.abs(chg) < minChg) return false;
      return true;
    })
    .slice(0, 60);

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-7xl mx-auto">
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Screener
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Breakouts · movers above +{minChg}%
        </p>
        <div className="flex flex-wrap gap-3 mb-6 text-sm font-mono">
          <label className="flex items-center gap-2">
            MIN %
            <input
              type="number"
              value={minChg}
              onChange={(e) => setMinChg(parseFloat(e.target.value) || 0)}
              className="w-20 border border-border px-2 py-1.5"
            />
          </label>
          <button
            onClick={() => setOnlyGainers(!onlyGainers)}
            className="border border-border px-4 py-1.5 hover:bg-muted"
          >
            {onlyGainers ? "GAINERS ONLY" : "GAINERS + LOSERS"}
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loading />
          </div>
        ) : out.length === 0 ? (
          <div className="broker-card px-6 py-12 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/60 text-foreground/60">
              <FiSearch size={19} aria-hidden />
            </span>
            <div className="mt-3 text-[13.5px] font-medium">No matches</div>
            <div className="mt-1 text-[12.5px] text-muted-foreground">
              Lower the MIN % or toggle GAINERS + LOSERS
            </div>
          </div>
        ) : (
          <div className="border border-border bg-card">
            <div className="grid grid-cols-4 gap-4 bg-muted px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Symbol</span>
              <span className="text-right">LTP</span>
              <span className="text-right">% Chg</span>
              <span className="text-right">Volume</span>
            </div>
            {out.map((r: any) => (
              <div
                key={r.symbol}
                className="grid grid-cols-4 gap-4 px-6 py-2.5 border-b border-border last:border-0 text-sm font-mono density-row hover:bg-muted"
              >
                <NavTransition
                  href={`/stocks/${r.symbol}`}
                  className="font-semibold hover:underline"
                >
                  {r.symbol}
                </NavTransition>
                <span className="text-right">
                  ₹{Number(r.ltp ?? r.lastPrice ?? 0).toFixed(2)}
                </span>
                <span
                  className={`text-right ${(r.dayChangePerc ?? 0) >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {Number(r.dayChangePerc ?? r.pChange ?? 0).toFixed(2)}%
                </span>
                <span className="text-right">
                  {Number(r.volume ?? r.totalTradedVolume ?? 0).toLocaleString(
                    "en-IN",
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
