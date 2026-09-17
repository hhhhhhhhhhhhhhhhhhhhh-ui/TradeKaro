export default function IndicesComponent(props: any) {
  let data = props.data;
  if (!data?.data) return null;
  const isPositive = (data.data?.dayChange ?? 0) >= 0;

  return (
    <div className="broker-card broker-card-hover relative flex flex-col px-5 py-4 min-w-[160px] cursor-default overflow-hidden">
      <div
        className={`absolute top-0 left-0 right-0 h-[2px] ${isPositive ? "bg-positive" : "bg-negative"}`}
      />
      <span className="mb-3 mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {data.name}
      </span>
      <span className="text-2xl font-mono font-semibold text-foreground mb-1">
        {data.data?.value}
      </span>
      <div
        className={`flex flex-row gap-1 text-xs font-mono font-medium ${isPositive ? "text-positive" : "text-negative"}`}
      >
        <span>
          {isPositive ? "+" : ""}
          {Number(data.data?.dayChange ?? 0).toFixed(2)}
        </span>
        <span>
          ({isPositive ? "+" : ""}
          {Number(data.data?.dayChangePerc ?? 0).toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}
