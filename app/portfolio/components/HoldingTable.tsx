import { NavTransition } from "@/app/components/navbar/NavTransition";
import { FiPieChart } from "react-icons/fi";
import { money } from "@/app/lib/format";

export default function HoldingTable(props: any) {
  const { data, profitData } = props;

  function getProfitsByScrip(scrip: string) {
    if (!profitData || profitData.length === 0) return "0.00";
    for (let i = 0; i < profitData.length; i++) {
      if (profitData[i].scrip === scrip) {
        return profitData[i].profit?.toFixed(2) || "0.00";
      }
    }
    return "0.00";
  }

  function getProfitPerScrip(scrip: string) {
    if (!profitData || profitData.length === 0) return "0.00";
    for (let i = 0; i < profitData.length; i++) {
      if (profitData[i].scrip === scrip) {
        return profitData[i].profitPerShare?.toFixed(2) || "0.00";
      }
    }
    return "0.00";
  }

  function getLTP(scrip: string) {
    if (!profitData || profitData.length === 0) return "0.00";
    for (let i = 0; i < profitData.length; i++) {
      if (profitData[i].scrip === scrip) {
        return profitData[i].ltp?.toFixed(2) || "0.00";
      }
    }
    return "0.00";
  }

  if (!data || data.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/60 text-foreground/60">
          <FiPieChart size={19} aria-hidden />
        </span>
        <div className="mt-3 text-[13.5px] font-medium">No holdings yet</div>
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          Buy your first stock — it will show here with live P&amp;L
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="sm:hidden divide-y divide-border">
        {data.map((holding: any) => {
          if (!holding || !holding.scrip) return null;
          const profit = parseFloat(getProfitsByScrip(holding.scrip) || "0");
          const isProfitPositive = profit >= 0;
          const buyPrice = holding.buyPrice || 0;
          const quantity = holding.quantity || 0;
          return (
            <NavTransition
              key={holding.scrip}
              href={`/stocks/${encodeURIComponent(holding.scrip)}`}
              className="block px-4 py-3 active:bg-muted row-slide"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-mono font-semibold text-foreground truncate">
                    {holding.scrip}
                  </div>
                  <div className="text-[11px] font-mono text-foreground/60 display-num">
                    {quantity} · BUY {money(buyPrice, 2)} · LTP ₹
                    {getLTP(holding.scrip)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-mono font-bold display-num ${
                      isProfitPositive ? "text-positive" : "text-negative"
                    }`}
                  >
                    {isProfitPositive ? "+" : "−"}₹{Math.abs(profit).toFixed(0)}
                  </div>
                  <div className="text-[11px] font-mono text-foreground/60 display-num">
                    ₹{(quantity * buyPrice).toFixed(0)}
                  </div>
                </div>
              </div>
            </NavTransition>
          );
        })}
      </div>
      <div className="hidden sm:block w-full overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="px-4 py-2 bg-muted">
            <div className="grid grid-cols-6 gap-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <div className="text-left">Scrip</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Buy</div>
              <div className="text-right">LTP</div>
              <div className="text-right">P/L</div>
              <div className="text-right">Value</div>
            </div>
          </div>
          <div className="divide-y divide-border">
            {data.map((holding: any) => {
              if (!holding || !holding.scrip) return null;
              const profit = parseFloat(
                getProfitsByScrip(holding.scrip) || "0",
              );
              const isProfitPositive = profit >= 0;
              const buyPrice = holding.buyPrice || 0;
              const quantity = holding.quantity || 0;

              return (
                <div
                  key={holding.scrip}
                  className="px-4 py-2 hover:bg-muted transition-colors"
                >
                  <div className="grid grid-cols-6 gap-3 text-[12px] font-mono items-center">
                    <div className="text-left">
                      <NavTransition
                        href={`/stocks/${encodeURIComponent(holding.scrip)}`}
                        className="font-semibold text-foreground hover:underline truncate block"
                      >
                        {holding.scrip}
                      </NavTransition>
                    </div>
                    <div className="text-right display-num">{quantity}</div>
                    <div className="text-right display-num">
                      ₹{buyPrice.toFixed(1)}
                    </div>
                    <div className="text-right display-num">
                      ₹{getLTP(holding.scrip)}
                    </div>
                    <div
                      className={`text-right font-bold display-num ${
                        isProfitPositive ? "text-positive" : "text-negative"
                      }`}
                    >
                      {isProfitPositive ? "+" : "−"}₹
                      {Math.abs(profit).toFixed(0)}
                    </div>
                    <div className="text-right display-num">
                      ₹{(quantity * buyPrice).toFixed(0)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
