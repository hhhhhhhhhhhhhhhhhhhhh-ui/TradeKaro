"use client";
import Loading from "@/app/components/Loading";

// Win-rate, CAGR proxy, concentration from existing backend payload.
export default function AnalyticsPanel(props: {
  data: any;
  profitDetails: any;
  loading: boolean;
}) {
  const { data, profitDetails, loading } = props;
  if (loading)
    return (
      <div className="flex justify-center py-8">
        <Loading />
      </div>
    );
  const scrips: any[] = data.scrips || [];
  const profits: any[] = profitDetails.profitArray || [];
  const wins = profits.filter((p) => (p.profit || 0) > 0).length;
  const winRate = profits.length
    ? ((wins / profits.length) * 100).toFixed(1)
    : "0.0";
  const total = scrips.reduce(
    (a, s) => a + (s.quantity || 0) * (s.buyPrice || 0),
    0,
  );
  const top = scrips.length
    ? Math.max(
        ...scrips.map(
          (s) => ((s.quantity || 0) * (s.buyPrice || 0)) / (total || 1),
        ),
      ) * 100
    : 0;
  const avgHold = data.orderBook?.length
    ? `${Math.max(1, Math.round(365 / data.orderBook.length))}d`
    : "—";
  const cards = [
    { label: "WIN RATE", value: `${winRate}%` },
    { label: "OPEN LEGS", value: String(scrips.length) },
    { label: "TOP WEIGHT", value: `${top.toFixed(1)}%` },
    { label: "AVG HOLD", value: avgHold },
    {
      label: "REALIZED+UNREALIZED",
      value: `₹${(profitDetails.overallProfit || 0).toFixed(2)}`,
    },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
      {cards.map((c) => (
        <div key={c.label} className="broker-card px-3 py-2 text-center">
          <div className="eyebrow">{c.label}</div>
          <div className="display-num text-[13px] font-bold truncate">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
