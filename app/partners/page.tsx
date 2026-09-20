import Link from "next/link";
import type { Metadata } from "next";
import {
  FiArrowRight,
  FiBarChart2,
  FiChevronRight,
  FiCreditCard,
  FiLink2,
  FiShield,
  FiTrendingUp,
  FiUsers,
  FiZap,
} from "react-icons/fi";

// Public partner programme page.
//
// DELIBERATELY PUBLISHES NO RATES. Terms are agreed partner by partner, so the
// page explains what the programme is and how earning works — on verified
// deposits, never on signups — and quotes no percentage at all. Do not add a
// rate back here without being asked: a number on this page becomes a promise
// we then have to honour for everyone, which is the opposite of negotiating.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TradeStox Partners — get paid for the traders you send",
  description:
    "Earn a share of every verified deposit from the traders you refer. UPI and USDT payouts, and a live dashboard showing what your traffic is worth.",
};

const FEATURES: [React.ReactNode, string, string][] = [
  [
    <FiBarChart2 key="a" size={17} />,
    "A live dashboard, not a monthly email",
    "Clicks, signups, funded customers and commission — refresh any time. No waiting for a report.",
  ],
  [
    <FiShield key="b" size={17} />,
    "Server-side attribution",
    "Every click is recorded on our side. A cleared cookie, a private window or a switch from phone to laptop cannot lose you a customer.",
  ],
  [
    <FiCreditCard key="c" size={17} />,
    "UPI and USDT payouts",
    "Request a withdrawal to a UPI ID, a bank account or a USDT wallet. No minimum-stress, no locked-in periods beyond the holdback.",
  ],
  [
    <FiLink2 key="d" size={17} />,
    "Purpose-built landing pages",
    "Send traffic to a page built for your audience instead of a generic homepage. Tag campaigns and see which one pays.",
  ],
  [
    <FiTrendingUp key="e" size={17} />,
    "Fees absorbed by us",
    "Commission is a straight percentage of the verified deposit. Payment-gateway costs never come out of your cut.",
  ],
  [
    <FiUsers key="f" size={17} />,
    "One customer, one owner",
    "The first recorded click owns a customer permanently. Nobody can take them from you later.",
  ],
];

export default function PartnersLanding() {
  return (
    <div className="min-h-dvh bg-background">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <Link href="/partners" className="flex items-center gap-2.5">
            <span className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-[13px] font-black text-white">
              TS
            </span>
            <span className="leading-none">
              <span className="block text-[13.5px] font-semibold tracking-tight text-foreground">
                TradeStox
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                Partners
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/partners/login"
              className="pressable hidden h-9 items-center rounded-xl px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              Partner sign in
            </Link>
            <Link
              href="/partners/join"
              className="pressable btn-money inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12.5px] font-semibold"
            >
              Apply now
              <FiArrowRight size={13} />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-brand/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-24 h-[320px] w-[320px] rounded-full bg-brand-lime/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1120px] px-4 pb-10 pt-12 lg:px-8 lg:pb-16 lg:pt-20">
          <div className="eyebrow">Partner programme</div>
          <h1 className="mt-3 max-w-[18ch] text-[34px] font-semibold leading-[1.06] tracking-tight text-foreground sm:text-[46px] lg:text-[56px]">
            Get paid for the traders you send.
          </h1>
          <p className="mt-4 max-w-[60ch] text-[14.5px] leading-relaxed text-muted-foreground sm:text-[16px]">
            Share a link. We handle onboarding, verification and support. You
            earn a share of every verified deposit from the accounts you bring
            in — with a dashboard that tells you exactly what your traffic is
            worth.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/partners/join"
              className="pressable btn-money inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[13.5px] font-semibold"
            >
              Apply as a partner
              <FiArrowRight size={15} />
            </Link>
            <Link
              href="/partners/login"
              className="pressable inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-6 text-[13.5px] font-semibold text-foreground"
            >
              I already have an account
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
            {[
              { k: "Attribution window", v: "60 days" },
              { k: "Payouts", v: "UPI · Bank · USDT" },
              { k: "Review time", v: "1 working day" },
            ].map((s) => (
              <div key={s.k}>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {s.k}
                </div>
                <div className="display-num mt-1 text-[17px] font-semibold text-foreground">
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How you get paid ─────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-[1120px] px-4 py-12 lg:px-8">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">
            How you get paid
          </h2>
          <p className="mt-2 max-w-[64ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Your terms are agreed with you directly, when we review your
            application — they depend on your audience, your channels and the
            volume you can bring, so we would rather talk than post a number
            that fits nobody.
          </p>
          <p className="mt-4 max-w-[64ch] text-[13.5px] leading-relaxed text-muted-foreground">
            What every partner gets is the same rule underneath: we pay on{" "}
            <strong className="font-semibold text-foreground">
              verified deposits
            </strong>{" "}
            — real money that actually arrived, confirmed by the payment
            gateway. Never on signups alone, and never on a number the gateway
            did not receive.
          </p>
          <p className="mt-4 max-w-[64ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Apply, tell us what you do, and we will come back with an offer —
            usually within one working day.
          </p>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-4 py-12 lg:px-8">
        <h2 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">
          Built for people who drive real traffic
        </h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, body]) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
                {icon}
              </span>
              <div className="mt-3 text-[13.5px] font-semibold text-foreground">
                {title}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-[1120px] px-4 py-12 lg:px-8">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">
            From application to first payout
          </h2>
          <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Apply",
                "Tell us who you are and where your audience is. Takes two minutes.",
              ],
              [
                "Get approved",
                "We review every application by hand and set your rates — usually within a working day.",
              ],
              [
                "Share your link",
                "Pick a landing page, tag a campaign, copy the link. Every click is tracked.",
              ],
              [
                "Request a payout",
                "Watch commission land in your dashboard and withdraw to UPI or USDT.",
              ],
            ].map(([t, b], i) => (
              <li
                key={t}
                className="relative rounded-2xl border border-border bg-card p-4"
              >
                <span className="display-num grid h-7 w-7 place-items-center rounded-full brand-gradient text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="mt-3 text-[13.5px] font-semibold text-foreground">
                  {t}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {b}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-4 py-14 lg:px-8">
        <div className="relative overflow-hidden broker-card p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-20 h-60 w-60 rounded-full bg-brand/12 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-[52ch]">
              <div className="eyebrow">Ready when you are</div>
              <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-foreground sm:text-[28px]">
                Apply once. Get a panel for life.
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                No fees, no exclusivity, no minimum volume. If your audience
                trades Indian markets, they belong on TradeStox.
              </p>
            </div>
            <Link
              href="/partners/join"
              className="pressable btn-money inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[13.5px] font-semibold"
            >
              Start your application
              <FiArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[11.5px] text-muted-foreground lg:px-8">
          <span>
            © {new Date().getFullYear()} TradeStox. All rights reserved.
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/partners/login" className="hover:text-foreground">
              Partner sign in
            </Link>
            <Link href="/partners/join" className="hover:text-foreground">
              Apply
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Trading app <FiChevronRight size={11} />
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile sticky CTA — the one action that matters on a phone. */}
      <div className="sticky bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-xl sm:hidden">
        <Link
          href="/partners/join"
          className="pressable btn-money inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold"
        >
          <FiZap size={15} />
          Apply as a partner
        </Link>
      </div>
    </div>
  );
}
