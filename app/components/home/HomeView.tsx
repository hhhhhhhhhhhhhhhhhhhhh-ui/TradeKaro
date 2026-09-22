import type { ReactNode } from "react";
import {
  FiActivity,
  FiBarChart2,
  FiClock,
  FiCpu,
  FiLayers,
  FiFilter,
  FiPlus,
  FiShield,
  FiStar,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import MarqueeTicker from "@/app/components/landing/MarqueeTicker";
import LandingSearch from "@/app/components/landing/LandingSearch";
import {
  LiveMovers,
  LiveRelianceCard,
  LiveSpark,
  LiveWatchlist,
} from "@/app/components/landing/LiveLandingBlocks";
import LiveMarketStrip from "./LiveMarketStrip";
import NewsFeed from "@/app/dashboard/sections/NewsFeed";

// ── layout helpers ──────────────────────────────────────────────────────────

function Band({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`px-4 sm:px-6 lg:px-8 ${className}`}>
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

/** Eyebrow + tracking-tight heading + one paragraph. Used by every section. */
function Head({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <div className="mb-8 max-w-3xl sm:mb-12">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-4xl md:text-[42px]">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground sm:text-[15px]">
          {lead}
        </p>
      )}
    </div>
  );
}

/** 36px tile with a line icon — the app's standard for a feature mark. */
function IconTile({ Icon }: { Icon: typeof FiZap }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-foreground/70">
      <Icon size={17} strokeWidth={1.8} aria-hidden />
    </span>
  );
}

const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-md bg-brand px-7 py-3.5 text-[13.5px] font-semibold text-brand-foreground transition-colors hover:bg-brand/90";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-6 py-3.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-muted";

// ── content ─────────────────────────────────────────────────────────────────

const FACTS = [
  { value: "NSE · BSE · MCX", label: "Markets covered" },
  { value: "2,000+", label: "Tradable instruments" },
  { value: "Live", label: "Real-time market feed" },
  { value: "Up to 20x", label: "Intraday leverage" },
];

const FEATURES: { Icon: typeof FiZap; title: string; body: string }[] = [
  {
    Icon: FiTrendingUp,
    title: "Option chain",
    body: "Every strike and expiry on one screen, with live Greeks and a payoff chart sitting next to the price you are about to pay.",
  },
  {
    Icon: FiBarChart2,
    title: "Charting that respects the contract",
    body: "Candles and lines across 1D to 1Y with IST timestamps, stepping by each contract's own tick size rather than a guessed one.",
  },
  {
    Icon: FiLayers,
    title: "Five levels of depth",
    body: "Live bids and asks on the stock page. Tap any row to pull that exact price into the ticket.",
  },
  {
    Icon: FiStar,
    title: "Watchlists that move together",
    body: "Group the symbols you follow, across equities and commodities, and watch them update side by side.",
  },
  {
    Icon: FiFilter,
    title: "Screener and movers",
    body: "Filter the listed universe, then see where the day's volume and momentum actually went.",
  },
  {
    Icon: FiShield,
    title: "Risk controls that hold",
    body: "Margin, position caps, an intraday square-off that runs whether or not your tab is open, and an operator kill switch.",
  },
];

const MARKETS = [
  {
    kicker: "Equities",
    title: "NSE and BSE cash",
    body: "Live quotes, depth, 52-week ranges and announcements across the listed universe.",
  },
  {
    kicker: "F&O",
    title: "Index and stock options",
    body: "Weekly and monthly expiries on one chain, with Greeks and payoff before you commit.",
  },
  {
    kicker: "MCX",
    title: "Commodities",
    body: "Gold, silver, crude and the base metals — quoted in the units the exchange actually uses, traded until 23:30.",
  },
  {
    kicker: "Indices",
    title: "NIFTY, BANK NIFTY, SENSEX",
    body: "Live levels alongside the breadth and the movers that are driving them.",
  },
];

const BOARD = [
  {
    Icon: FiCpu,
    value: "1",
    label: "upstream call",
    body: "per symbol per interval, however many people are watching. One shared board serves every tab and every visitor.",
  },
  {
    Icon: FiActivity,
    value: "8s",
    label: "client poll",
    body: "one poller per tab, paused while the tab is hidden. Nothing keeps polling a page nobody is looking at.",
  },
  {
    Icon: FiClock,
    value: "60s",
    label: "candle cache",
    body: "history is fetched once and shared server-side, so a thousand chart opens cost the provider one request.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Create your account",
    body: "Name, email and mobile number. About two minutes on a phone, no card needed.",
  },
  {
    n: "02",
    title: "Add funds when you are ready",
    body: "UPI or netbanking. The balance is credited the moment the payment gateway confirms it.",
  },
  {
    n: "03",
    title: "Trade the live market",
    body: "Live prices, fast tickets and a position book that updates as the market does.",
  },
];

const FAQ = [
  {
    q: "Which markets can I trade?",
    a: "NSE and BSE equities, NSE index and stock options, and MCX commodities — all from one account and one watchlist, with no second platform to learn.",
  },
  {
    q: "How do I add funds?",
    a: "From the wallet page, by UPI or netbanking. The balance is credited once the payment gateway confirms the payment — not on anything your browser reports.",
  },
  {
    q: "How do withdrawals work?",
    a: "Request one from your wallet at any time. It is paid only to a bank account or UPI ID saved in your own name, and may be subject to a minimum amount, verification and review before it is sent.",
  },
  {
    q: "Do I need to complete KYC?",
    a: "KYC is what unlocks withdrawals and the account connection token. The deposit threshold that starts it is set on the platform and shown on your KYC page, with progress towards it.",
  },
  {
    q: "How much leverage do I get?",
    a: "Intraday margin is charged as a percentage of trade value — 5% gives you up to 20x. Your effective rate is shown on the order ticket before you place anything, and it is the same number the ledger charges.",
  },
  {
    q: "Where does the market data come from?",
    a: "Live quotes, option chains and candles come straight from the exchange feed and are served through a single shared board, so every visitor sees the same price at the same moment.",
  },
];

// India does not have one trading session — each venue keeps its own hours, and
// commodities run eight hours past the equity close.
const SESSIONS = [
  { name: "NSE cash", note: "Equities · IST", time: "09:15 – 15:30" },
  { name: "NFO", note: "Index and stock options · IST", time: "09:15 – 15:40" },
  { name: "MCX", note: "Commodities · IST", time: "09:00 – 23:30" },
];

// ── page ────────────────────────────────────────────────────────────────────

export default function HomeView() {
  return (
    <div className="pb-8">
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pt-20">
        {/* Brand wash. Decoration only — aria-hidden, no pointer events, and it
            fades out well before it reaches any text, so nothing here depends
            on a colour it is sitting on. A flat page is what makes a terminal
            look like a template. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-[560px]"
          style={{
            background:
              "radial-gradient(54% 50% at 14% 0%, rgb(var(--brand) / 0.16), transparent 70%), radial-gradient(38% 42% at 92% 6%, rgb(var(--brand-lime) / 0.13), transparent 72%)",
          }}
        />

        <div className="relative mx-auto max-w-7xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-positive/30 bg-card px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-positive">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
            </span>
            Live · NSE · BSE · MCX
          </span>

          <h1 className="mt-6 max-w-5xl text-[42px] font-bold leading-[0.95] tracking-tighter text-foreground sm:text-6xl lg:text-7xl xl:text-[86px]">
            The whole Indian market.
            <br />
            <span className="text-brand">One account.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground sm:mt-8 sm:text-[17px]">
            Equities, options and commodities on live exchange prices — with
            real market depth, an option chain that keeps up, and an order desk
            that never makes you wait.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:mt-11 sm:flex-row">
            <NavTransition href="/signup" className={PRIMARY}>
              Open an account
            </NavTransition>
            <NavTransition href="/stocks" className={SECONDARY}>
              Explore the market
            </NavTransition>
          </div>
        </div>
      </section>

      {/* ── LIVE LEVELS ────────────────────────────────────────────────── */}
      <Band className="mt-12 sm:mt-16">
        <LiveMarketStrip />
      </Band>

      <div className="mt-10 sm:mt-14">
        <MarqueeTicker />
      </div>

      {/* ── FACTS ──────────────────────────────────────────────────────── */}
      <Band className="mt-16 sm:mt-24">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.label} className="bg-card p-5 sm:p-6 lg:p-7">
              <div className="display-num break-words text-lg font-semibold text-foreground sm:text-xl lg:text-2xl">
                {f.value}
              </div>
              <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {f.label}
              </div>
            </div>
          ))}
        </div>
      </Band>

      <LandingSearch />

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="The desk"
          title={
            <>
              Built for the whole
              <br className="hidden sm:block" /> trading day.
            </>
          }
          lead="A terminal is only as good as the parts you touch most. These are the ones we spent the time on."
        />

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-4 bg-card p-5 transition-colors hover:bg-muted/60 sm:p-6 lg:p-7"
            >
              <IconTile Icon={Icon} />
              <div>
                <h3 className="text-[15.5px] font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Band>

      {/* ── LIVE SHOWCASE ──────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="Live now"
          title="This is the real thing, not a screenshot."
          lead="Everything below is pulled from the same live board the app trades on. Check it against your own terminal."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="broker-card flex flex-col justify-between gap-6 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Equity</div>
                <div className="mt-2">
                  <LiveRelianceCard />
                </div>
              </div>
              <LiveSpark symbol="RELIANCE" w={140} h={48} id="sg-hero" />
            </div>
            <NavTransition
              href="/stocks/RELIANCE"
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Open RELIANCE
            </NavTransition>
          </div>

          <div className="broker-card p-5 sm:p-6">
            <div className="eyebrow">Watchlist</div>
            <p className="mb-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              The names you follow, updating together.
            </p>
            <LiveWatchlist />
          </div>

          <div className="broker-card p-5 sm:p-6">
            <div className="eyebrow">Movers</div>
            <p className="mb-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              Where the day&rsquo;s volume actually went.
            </p>
            <LiveMovers />
          </div>
        </div>
      </Band>

      {/* ── MARKETS ────────────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="Coverage"
          title="Four markets, one account."
          lead="No second platform, no separate funding, no separate watchlist."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-5">
          {MARKETS.map((m) => (
            <div key={m.title} className="broker-card p-5 sm:p-6">
              <div className="eyebrow">{m.kicker}</div>
              <h3 className="mt-3 text-[17px] font-semibold tracking-tight text-foreground">
                {m.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                {m.body}
              </p>
            </div>
          ))}
        </div>
      </Band>

      {/* ── THE BOARD ──────────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="Under the hood"
          title="One board. Every tab."
          lead="Price data is the thing most terminals get wrong at scale. Ours is shared, so being busy on the site does not make it slow."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
          {BOARD.map(({ Icon, value, label, body }) => (
            <div key={label} className="broker-card p-5 sm:p-6">
              <IconTile Icon={Icon} />
              <div className="mt-4 flex items-baseline gap-2">
                <span className="display-num text-3xl font-bold tracking-tight text-brand">
                  {value}
                </span>
                <span className="text-[12.5px] font-medium text-muted-foreground">
                  {label}
                </span>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Band>

      {/* ── START ──────────────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="Getting started"
          title="Up and running in three steps."
        />

        <div className="divide-y divide-border border-t border-border">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="flex flex-col gap-3 py-6 sm:flex-row sm:items-baseline sm:gap-10 sm:py-8"
            >
              <span className="display-num shrink-0 text-2xl font-bold text-muted-foreground/70 sm:w-16 sm:text-3xl">
                {s.n}
              </span>
              <h3 className="shrink-0 text-lg font-semibold tracking-tight text-foreground sm:w-64">
                {s.title}
              </h3>
              <p className="max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <NavTransition href="/signup" className={PRIMARY}>
            Create your account
          </NavTransition>
        </div>
      </Band>

      {/* ── NEWS + SESSIONS ────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head
          eyebrow="Market news"
          title="Filings the moment they land."
          lead="Exchange announcements as they are published, so you are reading the news rather than yesterday's headline."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="lg:col-span-2">
            <NewsFeed />
          </div>

          <div className="broker-card p-5 sm:p-6">
            <div className="eyebrow">Market hours</div>
            <p className="mb-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              India has three sessions, not one. Commodities keep trading eight
              hours after the equity close.
            </p>
            <div className="divide-y divide-border">
              {SESSIONS.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-foreground">
                      {s.name}
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {s.note}
                    </div>
                  </div>
                  <span className="display-num shrink-0 text-[12.5px] font-semibold text-brand">
                    {s.time}
                  </span>
                </div>
              ))}
            </div>
            <NavTransition
              href="/commodities"
              className="mt-5 inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              See commodity contracts
            </NavTransition>
          </div>
        </div>
      </Band>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <Band className="mt-16 border-t border-border pt-16 sm:mt-24 sm:pt-24">
        <Head eyebrow="Questions" title="The things people ask first." />

        <div className="max-w-3xl border-t border-border">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group border-b border-border py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-medium text-foreground">
                {q}
                <FiPlus
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                  className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="mt-3 max-w-2xl pr-8 text-[13.5px] leading-relaxed text-muted-foreground">
                {a}
              </p>
            </details>
          ))}
        </div>
      </Band>

      {/* ── CLOSING ────────────────────────────────────────────────────── */}
      <Band className="mt-16 pb-4 sm:mt-24">
        <div className="relative overflow-hidden rounded-2xl bg-foreground px-6 py-12 text-background sm:px-12 sm:py-16">
          {/* Brand wash. Decoration only — the panel's ink is set by
              text-background on the parent, so nothing here can affect it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(58% 80% at 88% 8%, rgb(var(--brand) / 0.38), transparent 68%), radial-gradient(40% 60% at 4% 100%, rgb(var(--brand-lime) / 0.14), transparent 70%)",
            }}
          />
          <h2 className="relative max-w-2xl text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl md:text-[42px]">
            Your next trade is two minutes away.
          </h2>
          <p className="relative mt-4 max-w-xl text-[14.5px] leading-relaxed text-background/70">
            Open the account, add funds when you are ready, and start trading
            the live market.
          </p>
          <div className="relative mt-8 flex flex-col gap-3 sm:flex-row">
            <NavTransition
              href="/signup"
              className="inline-flex items-center justify-center rounded-md bg-background px-6 py-3.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-background/90"
            >
              Open an account
            </NavTransition>
            <NavTransition
              href="/login"
              className="inline-flex items-center justify-center rounded-md border border-background/30 px-6 py-3.5 text-[13.5px] font-semibold text-background transition-colors hover:bg-background/10"
            >
              Sign in
            </NavTransition>
          </div>
        </div>
      </Band>
    </div>
  );
}
