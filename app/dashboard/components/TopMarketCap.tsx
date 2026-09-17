"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SectionHeader from "@/app/dashboard/components/SectionHeader";
import Sparkline from "@/app/components/Sparkline";

type SortKey = "company" | "price" | "chg" | "mcap";

export default function TopMarketCap(props: any) {
  const { data } = props;
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("mcap");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "company" ? 1 : -1);
    }
  }

  const rows = useMemo(() => {
    const recs: any[] = Array.isArray(data?.data?.records)
      ? [...data.data.records]
      : [];
    const val = (c: any): number => {
      switch (sortKey) {
        case "company":
          return 0;
        case "price":
          return Number(c?.livePriceDto?.ltp ?? 0);
        case "chg":
          return Number(c?.livePriceDto?.dayChangePerc ?? 0);
        case "mcap":
        default:
          return Number(c?.marketCap ?? 0);
      }
    };
    recs.sort((a, b) => {
      if (sortKey === "company") {
        const r = String(a?.companyName || "").localeCompare(
          String(b?.companyName || ""),
        );
        return r * sortDir;
      }
      return (val(a) - val(b)) * (sortDir === 1 ? 1 : -1);
    });
    return recs;
  }, [data, sortKey, sortDir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 1 ? " ▲" : " ▼") : "";
  const th =
    "select-none px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

  const count = rows.length || undefined;
  return (
    <div>
      <SectionHeader eyebrow="Market Cap" count={count} />
      <div className="broker-card overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className={`${th} text-left`}>
                <button
                  type="button"
                  onClick={() => toggle("company")}
                  className="hover:text-foreground transition"
                >
                  #&nbsp;&nbsp;Company{arrow("company")}
                </button>
              </th>
              <th className={`${th} text-right`}>
                <button
                  type="button"
                  onClick={() => toggle("price")}
                  className="hover:text-foreground transition"
                >
                  Price{arrow("price")}
                </button>
              </th>
              <th className={`${th} text-right`}>
                <button
                  type="button"
                  onClick={() => toggle("chg")}
                  className="hover:text-foreground transition"
                >
                  % Chg{arrow("chg")}
                </button>
              </th>
              <th className={`${th} text-right`}>
                <button
                  type="button"
                  onClick={() => toggle("mcap")}
                  className="hover:text-foreground transition"
                >
                  Mkt Cap{arrow("mcap")}
                </button>
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                52W High
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                52W Low
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((coin: any, index: number) => {
              if (!coin || !coin.nseScriptCode) return null;

              const isPositive = coin.livePriceDto?.dayChange > 0;
              const marketCapValue = coin.marketCap
                ? (parseInt(coin.marketCap) / 10000000).toLocaleString(
                    "en-IN",
                    {
                      maximumFractionDigits: 0,
                    },
                  )
                : "N/A";

              const spark = [
                Number(coin.livePriceDto?.ltp ?? 0) -
                  Number(coin.livePriceDto?.dayChange ?? 0),
                Number(coin.livePriceDto?.ltp ?? 0),
              ];
              return (
                <tr
                  key={coin.nseScriptCode || `market-cap-${index}`}
                  onClick={() =>
                    router.push(
                      `/stocks/${encodeURIComponent(coin.nseScriptCode)}`,
                    )
                  }
                  className="row-slide border-b border-border last:border-b-0 hover:bg-muted transition-colors cursor-pointer pressable"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs font-mono text-foreground/30 w-5 shrink-0 text-right">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {coin.companyName || "N/A"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-mono font-semibold text-foreground">
                        ₹{coin.livePriceDto?.ltp || "0.00"}
                      </span>
                      <span
                        className={`text-xs font-mono ${isPositive ? "text-positive" : "text-negative"}`}
                      >
                        {coin.livePriceDto?.dayChange !== undefined
                          ? `${isPositive ? "+" : ""}${coin.livePriceDto.dayChange.toFixed(2)} (${isPositive ? "+" : ""}${coin.livePriceDto.dayChangePerc?.toFixed(2) || "0.00"}%)`
                          : "N/A"}
                      </span>
                    </div>
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono text-sm font-semibold ${isPositive ? "text-positive" : "text-negative"}`}
                  >
                    {coin.livePriceDto?.dayChangePerc !== undefined
                      ? `${isPositive ? "+" : ""}${Number(coin.livePriceDto.dayChangePerc).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="hidden xl:inline-block align-middle mr-3">
                      <Sparkline
                        data={spark}
                        positive={isPositive}
                        id={`mc-${coin.nseScriptCode}-${index}`}
                      />
                    </span>
                    <span className="display-num text-sm text-foreground/70">
                      {marketCapValue} Cr
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right display-num text-sm text-accent">
                    ₹{coin.yearlyHighPrice || "N/A"}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm text-foreground/60">
                    ₹{coin.yearlyLowPrice || "N/A"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
