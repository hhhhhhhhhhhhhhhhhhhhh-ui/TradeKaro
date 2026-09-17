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
    /* No top padding: <main> already sits directly under the ticker tape, and a
       gap there just pushed the surface down. The width matches the app shell's
       container so the surface lines up with the navbar and ticker. */
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="sr-only">Positions</h1>
        <PositionsPanel />
      </div>
    </div>
  );
}
