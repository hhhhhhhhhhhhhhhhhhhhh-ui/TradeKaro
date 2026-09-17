import TopLosers from "./TopLosers";
import TopGainers from "./TopGainers";
import SectionHeader from "@/app/dashboard/components/SectionHeader";

export default function TopMoversSection(props: any) {
  const { data } = props;

  if (!data?.TOP_GAINERS && !data?.TOP_LOSERS) return null;
  // /api/v1/getTopMovers uses LARGECAP/MIDCAP/SMALLCAP buckets; a flat
  // /topmovers shape (items[]) has no buckets — show an honest empty state
  // instead of rendering broken cards.
  const hasBuckets =
    data?.TOP_GAINERS?.LARGECAP?.items || data?.TOP_LOSERS?.LARGECAP?.items;
  if (!hasBuckets) return null;

  return (
    <div className="space-y-12">
      <div>
        <SectionHeader
          eyebrow="Gainers"
          href="/topmovers"
          tone="text-positive"
        />
        <TopGainers data={data.TOP_GAINERS} />
      </div>

      <div>
        <SectionHeader
          eyebrow="Losers"
          href="/topmovers"
          tone="text-negative"
        />
        <TopLosers data={data.TOP_LOSERS} />
      </div>
    </div>
  );
}
