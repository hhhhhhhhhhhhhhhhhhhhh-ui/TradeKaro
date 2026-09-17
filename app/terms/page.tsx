import type { Metadata } from "next";
import { NavTransition } from "@/app/components/navbar/NavTransition";

export const metadata: Metadata = {
  title: "Terms & risk disclosure · TradeKaro",
  description:
    "What TradeKaro is, what it is not, and the risks of acting on market data.",
};

// Public, no auth. This page exists so the platform can describe itself
// accurately in one place while every product surface uses ordinary trading
// language. Keep it in step with components/Footer.tsx.

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What this platform is",
    body: [
      "TradeKaro is a market analysis and trading simulator for NSE/BSE securities. It streams live market data, lets you build watchlists, place orders into a simulated account, and track positions and profit and loss exactly as a trading terminal does.",
      "It exists to let you evaluate a strategy against real prices without committing capital.",
    ],
  },
  {
    title: "What this platform is not",
    body: [
      "TradeKaro is not a stock broker, exchange member, depository participant or investment adviser. It is not registered with SEBI, and it does not place, route or execute orders on any exchange.",
      "No funds are held, pooled or transferred. Balances, deposits and payouts shown in the product are simulated credits used to model trading; no money moves into or out of this platform.",
      "Nothing on this platform is investment advice, a recommendation, or an offer to buy or sell any security.",
    ],
  },
  {
    title: "Market data",
    body: [
      "Quotes, charts and option chains are sourced from a third-party market data provider and may be delayed, incomplete or inaccurate. Prices shown are indicative and can differ from the exchange feed.",
      "Outside trading hours the feed is frozen at the last available tick, so orders are validated against that last price rather than a live one.",
      "You should always confirm prices with your broker or the exchange before acting on anything you see here.",
    ],
  },
  {
    title: "Simulated results",
    body: [
      "Simulated performance is not a reliable indicator of future results. A simulated account cannot reproduce the effect of real market liquidity, execution delays, slippage or the psychology of risking your own money.",
      "Past performance, whether simulated or real, never guarantees future outcomes.",
    ],
  },
  {
    title: "Risk of real trading",
    body: [
      "Trading and investing in securities carries risk, including the risk of losing your entire capital. Leveraged and intraday positions can lose more than the amount deposited.",
      "Derivatives such as options and futures are complex instruments and are not suitable for every investor. Please read the exchange-issued risk disclosure documents and, where relevant, consult a SEBI-registered investment adviser before trading with real money.",
    ],
  },
  {
    title: "Accounts and access",
    body: [
      "You are responsible for keeping your login and any connection token private. Do not share a connection token — anyone holding it can link to your account.",
      "We may suspend or close an account that is used to abuse the platform or attempt to interfere with its operation.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="px-4 pt-8 pb-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Terms &amp; risk disclosure
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Please read this before using TradeKaro. By using the platform you
          accept the terms below.
        </p>

        <div className="mt-8 space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title} className="broker-card p-5 sm:p-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                {s.title}
              </h2>
              <div className="mt-3 space-y-3">
                {s.body.map((p) => (
                  <p
                    key={p}
                    className="text-[13px] leading-relaxed text-foreground/80"
                  >
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <NavTransition
            href="/"
            className="pressable inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[12px] font-semibold text-background"
          >
            BACK TO HOME
          </NavTransition>
          <NavTransition
            href="/dashboard"
            className="pressable inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/50"
          >
            GO TO DASHBOARD
          </NavTransition>
        </div>
      </div>
    </div>
  );
}
