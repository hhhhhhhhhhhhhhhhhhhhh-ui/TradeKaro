"use client";
import PositionsPanel from "@/app/portfolio/components/PositionsPanel";

/**
 * Dedicated positions page.
 *
 * The panel is self-contained — it owns its market-data subscriptions and
 * re-reads the tradebook on every ledger mutation — so this page is only the
 * shell around it. That also means nothing here has to know about the portfolio
 * tabs it used to live inside.
 */
export default function PositionsPage() {
  return (
    /* max-w-7xl is the app shell's container — same as the navbar, the ticker
       and every other trading surface (/portfolio, /portfolio/orders,
       /watchlist, /ledger, /options). This page was the only one on max-w-4xl,
       which left it 320px narrower than the chrome above it and floating in
       gutters no other page had. That mismatch is most of what made it read as
       an embedded card rather than the page itself.

       No visible page heading: the tab row already names the three views and
       carries their counts, so a title above it only pushed the Total P&L down
       the page. The h1 stays for screen readers and SEO — it is sr-only, so it
       costs no vertical space. pt-4 is just enough to clear the ticker. */
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="sr-only">Positions</h1>
        <PositionsPanel />
      </div>
    </div>
  );
}
