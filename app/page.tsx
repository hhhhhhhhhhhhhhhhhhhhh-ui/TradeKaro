import type { Metadata } from "next";
import HomeView from "./components/home/HomeView";

export const metadata: Metadata = {
  title: "TradeStox — Live NSE, BSE and MCX trading terminal",
  description:
    "Live Indian market data, option chains with Greeks, advanced charting and an order desk built for speed. NSE equities, F&O and MCX commodities in one account.",
};

// The homepage is a composition of live blocks and static sections rather than
// one long file: `HomeView` owns the layout, `LiveMarketStrip` the one piece
// that needs a client hook, and the rest is static copy that ships as HTML.
export default function Home() {
  return <HomeView />;
}
