import { NavTransition } from "@/app/components/navbar/NavTransition";

export default function TopMoverComponent(props: any) {
  let { companyName, ltp, dayChange, dayChangePerc, symbol, logoUrl } = props;
  const isPositive = dayChange >= 0;

  return (
    <NavTransition
      className="block"
      href={`/stocks/${encodeURIComponent(symbol)}`}
    >
      <div className="broker-card broker-card-hover pressable relative flex flex-col p-5 min-w-[180px] overflow-hidden">
        <div
          className={`absolute top-0 left-0 right-0 h-[2px] ${isPositive ? "bg-positive" : "bg-negative"}`}
        />
        <div className="flex flex-row items-center gap-2 mb-1 mt-1">
          {logoUrl && (
            <img
              src={logoUrl}
              alt={companyName}
              className="w-5 h-5 object-contain flex-shrink-0 opacity-75"
            />
          )}
          <span className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            {symbol}
          </span>
        </div>
        <p className="text-xs text-foreground/50 mb-3 line-clamp-1 font-mono">
          {companyName}
        </p>
        <span className="text-xl font-mono font-semibold text-foreground mb-1">
          ₹{ltp}
        </span>
        <div
          className={`flex flex-row gap-1 text-xs font-mono font-medium ${isPositive ? "text-positive" : "text-negative"}`}
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
      </div>
    </NavTransition>
  );
}
