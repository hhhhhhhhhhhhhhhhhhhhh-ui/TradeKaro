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
       an embedded card rather than the page itself. pt-8 because <main> sits
       directly under the ticker and the surface needs to clear it. */
    <div className="px-4 pt-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Positions
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Open holdings, intraday legs and closed round-trips.
          </p>
        </div>
        <PositionsPanel />
      </div>
    </div>
  );
}
