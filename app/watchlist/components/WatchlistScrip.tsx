"use client";
import { apiURL } from "@/app/components/apiURL";
import { symbols } from "@/app/components/symbols";
import { useCommodities } from "@/app/hooks/useCommodities";
import axios from "axios";
import Link from "next/link";
import { getCookie } from "cookies-next";
import { sileo } from "sileo";

export default function WatchlistScrip({
  scrip,
  onRemove,
}: {
  scrip: any;
  onRemove: (symbol: string) => void;
}) {
  const token = getCookie("token") as string | undefined;
  const commodities = useCommodities();
  const symbol = scrip.symbol;
  const ltp = scrip.ltp;
  const dayChange = scrip.dayChange;
  const dayChangePerc = scrip.dayChangePerc;
  const isPositive = dayChange > 0;

  // The equity master first, then the commodity master.
  //
  // This only knew about equities, so a commodity row rendered NO name at all —
  // a watchlist entry for GOLD appeared as a bare ticker with a blank line under
  // it. Falling through to the commodity list also gives the row a venue, which
  // is the one thing a reader needs to tell an MCX contract from a share.
  const key = decodeURIComponent(String(symbol || "")).toUpperCase();
  const equity = symbols.find((s) => s.Scrip === key);
  const commodity = commodities.find((c) => c.symbol === key);
  const companyName = commodity
    ? `${commodity.segmentLabel} · lot ${commodity.lot}`
    : equity?.["Company Name"] || "";

  async function handleRemove() {
    try {
      const results = await axios({
        method: "post",
        url: apiURL + "/transaction/removeWatchList",
        headers: { Authorization: "Bearer " + token },
        data: { scrip: symbol },
      });
      if (results.status === 200) {
        sileo.success({ title: "Removed " + symbol + " from watchlist" });
        onRemove(symbol);
      } else {
        sileo.error({
          title: "Failed to remove " + symbol + " from watchlist",
        });
      }
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 200) {
        sileo.success({ title: "Removed " + symbol + " from watchlist" });
        onRemove(symbol);
      } else {
        sileo.error({
          title: "Failed to remove " + symbol + " from watchlist",
        });
      }
    }
  }

  return (
    <div className="flex flex-col border border-border bg-card hover:bg-muted transition-colors h-full">
      <Link
        href={`/stocks/${encodeURIComponent(symbol)}`}
        className="flex flex-col p-6 flex-grow"
      >
        <span className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {symbol}
        </span>
        <span className="text-sm font-medium text-foreground mb-4 line-clamp-1">
          {companyName}
        </span>
        <span
          className={`text-2xl font-mono font-semibold mb-1 ${isPositive ? "text-positive" : "text-negative"}`}
        >
          ₹{ltp}
        </span>
        <div
          className={`flex flex-row gap-1 text-xs font-mono ${isPositive ? "text-positive" : "text-negative"}`}
        >
          <span>
            {isPositive ? "+" : ""}
            {dayChange.toFixed(2)}
          </span>
          <span>
            ({isPositive ? "+" : ""}
            {dayChangePerc.toFixed(2)}%)
          </span>
        </div>
      </Link>
      <div className="border-t border-border">
        <button
          onClick={handleRemove}
          className="w-full rounded-md px-4 py-3 text-center text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-negative"
        >
          REMOVE
        </button>
      </div>
    </div>
  );
}
