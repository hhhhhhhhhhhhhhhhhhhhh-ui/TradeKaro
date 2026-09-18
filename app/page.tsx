import { NavTransition } from "./components/navbar/NavTransition";
import MarqueeTicker from "./components/landing/MarqueeTicker";
import {
  LiveSpark,
  LiveRelianceCard,
  LiveWatchlist,
  LiveMovers,
} from "./components/landing/LiveLandingBlocks";
import LandingSearch from "./components/landing/LandingSearch";

function Chip({ label }: { label: string }) {
  return (
    <span className="mb-4 inline-block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

export default function Home() {
  return (
    <>
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-0">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-[0.92] mb-6 sm:mb-8 max-w-4xl">
            Trade Indian
            <br />
            stocks.
            <br />
            <span
              className="font-mono"
              style={{ color: "rgb(var(--positive))" }}
            >
              On live NSE data.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-foreground/60 max-w-xl mb-8 sm:mb-10 leading-relaxed">
            TradeStox is a free, open-source trading terminal for NSE. Trade on
            live data from 2000+ stocks — build your strategy, place orders, and
            track P&amp;L in real time.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-12 sm:mb-16">
            <NavTransition
              href="/signup"
              className="px-6 sm:px-8 py-3 sm:py-4 text-background bg-foreground hover:bg-foreground/90 transition-colors text-sm font-mono border border-foreground text-center"
            >
              OPEN AN ACCOUNT →
            </NavTransition>
            <NavTransition
              href="/dashboard"
              className="px-6 sm:px-8 py-3 sm:py-4 text-foreground bg-card hover:bg-muted transition-colors text-sm font-mono border border-border text-center"
            >
              OPEN DASHBOARD
            </NavTransition>
          </div>
        </div>

        <div>
          <MarqueeTicker />
        </div>
      </section>

      {/* ── STAT STRIP ────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 border-b border-l border-border">
            {[
              { value: "2000+", label: "NSE-LISTED SCRIPS" },
              { value: "₹2.5L", label: "STARTING CAPITAL" },
              { value: "1D·1W·1M·1Y", label: "CHART RANGES" },
              { value: "MIT", label: "LICENSE" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="border-t border-r border-border p-5 sm:p-6 lg:p-8"
              >
                <div className="mb-1 break-words font-mono text-xl font-semibold tabular-nums text-foreground sm:text-2xl md:text-3xl">
                  {stat.value}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <LandingSearch />

      {/* ── FEATURES — BENTO ─────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10 sm:mb-12">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              FEATURES
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mt-3 leading-tight">
              Real prices.
              <br />
              Real charts. Real practice.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-px bg-border border border-border">
            {/* DATA — col-span-2 */}
            <div className="sm:col-span-2 bg-card p-5 sm:p-8 hover:bg-muted transition-colors duration-200 flex flex-col justify-between gap-5 sm:gap-6">
              <div>
                <Chip label="DATA" />
                <h3 className="mb-2 text-[15px] font-semibold tracking-tight text-foreground">
                  Live data · 2000+ scrips
                </h3>
                <p className="text-sm text-foreground/50 leading-relaxed">
                  Real-time NSE prices, volume, open/high/low/close, 52-week
                  ranges — refreshed continuously.
                </p>
              </div>
              <div className="flex items-end gap-4 sm:gap-6 flex-wrap">
                <LiveSpark symbol="RELIANCE" />
                <LiveRelianceCard />
              </div>
            </div>

            {/* CHARTS — row-span-2 on md+ */}
            <div className="sm:col-span-2 md:col-span-1 md:row-span-2 bg-card p-5 sm:p-8 hover:bg-muted transition-colors duration-200 flex flex-col gap-5 sm:gap-6 border-b border-border">
              <div>
                <Chip label="CHARTS" />
                <h3 className="mb-2 text-[15px] font-semibold tracking-tight text-foreground">
                  Advanced charting
                </h3>
                <p className="text-sm text-foreground/50 leading-relaxed">
                  Candle &amp; line charts across four timeframes. Tooltips with
                  IST timestamps.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 flex-grow justify-center">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  NIFTY · LIVE UPSTOX
                </span>
                <LiveSpark symbol="NIFTY" w={180} h={120} id="sg-tall" />
                <div className="flex flex-wrap gap-2 mt-2">
                  {["1D", "1W", "1M", "1Y"].map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] border border-border px-2 py-1 text-muted-foreground hover:border-muted-foreground transition-colors"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                TIMEFRAMES: 1D · 1W · 1M · 1Y
              </p>
            </div>

            {/* PORTFOLIO */}
            <div className="bg-card p-5 sm:p-8 hover:bg-muted transition-colors duration-200 flex flex-col gap-4">
              <div>
                <Chip label="PORTFOLIO" />
                <h3 className="mb-1 text-[15px] font-semibold tracking-tight text-foreground">
                  Your portfolio
                </h3>
              </div>
              <div className="border border-border p-4 bg-background">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  TRADING CAPITAL
                </div>
                <div className="font-mono text-lg sm:text-xl font-bold text-foreground mb-2">
                  ₹1,00,000 starting capital
                </div>
                <p className="text-xs text-foreground/50 leading-relaxed">
                  Sign up to fund your account, place orders at live NSE prices,
                  and track P&amp;L here.
                </p>
              </div>
            </div>

            {/* WATCHLIST */}
            <div className="bg-card p-5 sm:p-8 hover:bg-muted transition-colors duration-200 flex flex-col gap-4 border-b border-border">
              <div>
                <Chip label="WATCHLIST" />
                <h3 className="mb-1 text-[15px] font-semibold tracking-tight text-foreground">
                  Customizable watchlists
                </h3>
              </div>
              <LiveWatchlist />
            </div>

            {/* MOVERS — spans the full row now that the OSS card is gone, so
                the grid has no empty cell at the bottom. */}
            <div className="sm:col-span-2 md:col-span-3 bg-card p-5 sm:p-8 hover:bg-muted transition-colors duration-200 flex flex-col gap-4">
              <div>
                <Chip label="MOVERS" />
                <h3 className="mb-1 text-[15px] font-semibold tracking-tight text-foreground">
                  Live top movers
                </h3>
              </div>
              <LiveMovers />
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10 sm:mb-12">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              FLOW
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mt-3">
              Up and running
              <br className="hidden sm:block" /> in under a minute.
            </h2>
          </div>
          <div className="flex flex-col divide-y divide-border border-t border-border">
            {[
              {
                n: "01",
                title: "Create a free account",
                sub: "No card required to start. Sign up and begin — it's fully open source.",
              },
              {
                n: "02",
                title: "Build your watchlist",
                sub: "Search across 2000+ NSE-listed scrips. Track the stocks you care about in real time.",
              },
              {
                n: "03",
                title: "Place your first order",
                sub: "Buy and sell with ₹2.5L starting capital. Watch your P&L move on live NSE prices.",
              },
            ].map((step) => (
              <div
                key={step.n}
                className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 md:gap-12 py-6 sm:py-8"
              >
                <span className="font-mono text-3xl sm:text-4xl md:text-5xl font-bold text-muted-foreground/30 shrink-0 sm:w-16">
                  {step.n}
                </span>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-8 md:gap-12 flex-1">
                  <h3 className="font-semibold text-lg sm:text-xl text-foreground sm:w-56 md:w-64 shrink-0">
                    {step.title}
                  </h3>
                  <p className="text-foreground/50 text-sm leading-relaxed max-w-xl">
                    {step.sub}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 sm:mt-12 border-t border-border pt-8 sm:pt-10">
            <NavTransition
              href="/signup"
              className="inline-block px-6 sm:px-8 py-3 sm:py-4 text-background bg-foreground hover:bg-foreground/90 transition-colors text-sm font-mono border border-foreground"
            >
              CREATE FREE ACCOUNT →
            </NavTransition>
          </div>
        </div>
      </section>
    </>
  );
}
