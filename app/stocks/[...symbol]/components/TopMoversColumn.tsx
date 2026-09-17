import TopMoversItem from "./TopMoversItem";

export default function TopMoversColumn(data: any) {
  const TOP_GAINERS: Array<object> = data?.data?.TOP_GAINERS?.items ?? [];
  const TOP_LOSERS: Array<object> = data?.data?.TOP_LOSERS?.items ?? [];
  if (!TOP_GAINERS.length && !TOP_LOSERS.length)
    return (
      <div className="broker-card p-5 text-[12.5px] text-muted-foreground">
        Top movers unavailable right now.
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-positive">
            TOP GAINERS
          </span>
        </div>
        <div className="border border-border bg-card divide-y divide-border">
          {TOP_GAINERS.map((item: any, index: number) => (
            <TopMoversItem
              key={item?.company?.nseScriptCode || `gainer-${index}`}
              data={item}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-negative">
            TOP LOSERS
          </span>
        </div>
        <div className="border border-border bg-card divide-y divide-border">
          {TOP_LOSERS.map((item: any, index: number) => (
            <TopMoversItem
              key={item?.company?.nseScriptCode || `loser-${index}`}
              data={item}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
