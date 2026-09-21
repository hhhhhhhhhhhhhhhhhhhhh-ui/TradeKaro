import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  FiActivity,
  FiArrowRight,
  FiBarChart2,
  FiCheckCircle,
  FiShield,
  FiSmartphone,
} from "react-icons/fi";
import { affiliateByCode, landingPage } from "@/app/lib/affiliates";
import TrackClick from "../TrackClick";

// Affiliate landing page: /l/<slug>?ref=PT-XXXXXX&c=campaign
//
// Server-rendered from the `landing_pages` table, so a new page can be published
// without a deploy. The affiliate code is validated here — an unknown or
// unapproved code still renders the page (the visitor should never see a broken
// site) but nothing is attributed and no cookie is set.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; c?: string; preview?: string }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const { preview } = await searchParams;
  const page = landingPage(slug);
  if (!page) return { title: "Not found — TradeStox" };
  return {
    title: `${page.title} — TradeStox`,
    description: page.subheadline || page.headline,
    // A partner preview is a working copy, not a page for the index. Without
    // this every preview URL a partner opens is a crawlable near-duplicate of
    // the real landing page, all differing by one query string.
    ...(preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function LandingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { ref = "", c = "", preview = "" } = await searchParams;
  const isPreview = preview === "1" || preview === "true";

  const page = landingPage(slug);
  if (!page) notFound();

  const affiliate = ref ? affiliateByCode(ref) : null;
  const valid = !!affiliate && affiliate.status === "approved";
  const code = valid ? affiliate!.code : "";
  const campaign = String(c || "").slice(0, 80);

  // Carried into the signup form as well as the cookie, so attribution survives
  // a browser that blocks cookies or a user who opens the link in a new profile.
  const signupHref = `/signup${code ? `?ref=${encodeURIComponent(code)}${campaign ? `&c=${encodeURIComponent(campaign)}` : ""}` : ""}`;

  return (
    <div className="min-h-dvh bg-background">
      {valid ? (
        <TrackClick
          code={code}
          slug={page.slug}
          campaign={campaign}
          preview={isPreview}
        />
      ) : null}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-[13px] font-black text-white">
              TS
            </span>
            <span className="leading-none">
              <span className="block text-[13.5px] font-semibold tracking-tight text-foreground">
                TradeStox
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                {page.tags || "Indian markets"}
              </span>
            </span>
          </div>
          <Link
            href="/login"
            className="pressable inline-flex h-9 items-center rounded-xl px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-28 h-[400px] w-[400px] rounded-full bg-brand/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-28 top-32 h-[280px] w-[280px] rounded-full bg-brand-lime/10 blur-3xl" />

        <div className="relative mx-auto max-w-[1100px] px-4 pb-7 pt-7 sm:pt-11 lg:px-8 lg:pb-14 lg:pt-20">
          <div className="eyebrow flex items-center gap-2">
            <span className="live-dot" />
            {page.tags || "Live markets"}
          </div>

          <h1 className="mt-3 max-w-[19ch] text-[30px] font-semibold leading-[1.08] tracking-tight text-foreground sm:max-w-[20ch] sm:text-[44px] lg:text-[56px]">
            {page.headline}
          </h1>

          {page.subheadline ? (
            <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-muted-foreground sm:mt-4 sm:text-[16px]">
              {page.subheadline}
            </p>
          ) : null}

          {page.offer ? (
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/8 px-3.5 py-1.5 text-[12px] font-semibold text-brand">
              <FiCheckCircle size={14} />
              {page.offer}
            </div>
          ) : null}

          {/* Full-width on a phone: thumbs, not cursors. A 44px minimum tap
              target, one clear primary action, the secondary below it. */}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Link
              href={signupHref}
              className="pressable btn-money inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold sm:h-12 sm:w-auto sm:text-[13.5px]"
            >
              {page.cta}
              <FiArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="pressable inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 text-[13.5px] font-semibold text-foreground sm:h-12 sm:w-auto"
            >
              I already have an account
            </Link>
          </div>

          <p className="mt-3 text-[11.5px] text-muted-foreground">
            No account-opening charge. Practise with virtual funds before you
            trade.
          </p>
        </div>
      </section>

      {/* ── This page's own selling points ──────────────────────────────────
          Two columns on a phone, not one. A single column of four bullets is
          a long grey wall on a 390px screen; tiles read as a feature set and
          let the offers that matter sit above the fold. */}
      {page.highlights.length ? (
        <section className="border-y border-border bg-card/40">
          <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-8 lg:py-10">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {page.highlights.map((h) => (
                <div
                  key={h}
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 sm:p-3.5"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
                    <FiCheckCircle size={14} />
                  </span>
                  <span className="text-[12.5px] font-medium leading-snug text-foreground sm:text-[13px]">
                    {h}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Proof points ────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid max-w-[1100px] gap-3 px-4 py-9 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:px-8 lg:py-12">
          {[
            [
              <FiBarChart2 key="1" size={18} />,
              "Real charts, real depth",
              "Candlesticks, indicators and an option chain that loads instantly — not a spreadsheet with colours.",
            ],
            [
              <FiActivity key="2" size={18} />,
              "NSE, BSE and MCX in one place",
              "Equities, futures, options and commodities share one terminal and one watchlist.",
            ],
            [
              <FiShield key="3" size={18} />,
              "Money out to your own account",
              "Withdrawals go only to the bank or UPI account registered in your name — never to a destination someone else added.",
            ],
          ].map(([icon, title, body]) => (
            <div
              key={String(title)}
              className="rounded-2xl border border-border bg-card p-3.5 sm:p-4"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
                {icon as React.ReactNode}
              </span>
              <div className="mt-2.5 text-[13px] font-semibold text-foreground sm:text-[13.5px]">
                {title as string}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground sm:text-[12.5px]">
                {body as string}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────
          Three steps, because on a phone the visitor's real question is not
          "what does it do" but "how much of my evening does this cost me". */}
      <section className="mx-auto max-w-[1100px] px-4 py-10 lg:px-8 lg:py-14">
        <h2 className="text-[20px] font-semibold tracking-tight text-foreground sm:text-[25px]">
          Open and trading in three steps
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {[
            [
              "1",
              "Create your account",
              "Name, email, mobile number. About two minutes on a phone.",
            ],
            [
              "2",
              "Fund it your way",
              "UPI or netbanking. Add money when you are ready — the practice book needs none.",
            ],
            [
              "3",
              "Trade the live market",
              "NSE, BSE and MCX are live the moment you sign in. Start small, size up when it earns it.",
            ],
          ].map(([n, t, d]) => (
            <div
              key={n}
              className="flex gap-3 rounded-2xl border border-border bg-card p-3.5 sm:p-4"
            >
              <span className="display-num grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand/12 text-[13px] font-bold text-brand">
                {n}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-foreground sm:text-[13.5px]">
                  {t}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground sm:text-[12.5px]">
                  {d}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1100px] px-4 pb-12 lg:px-8 lg:pb-14">
        <div className="relative overflow-hidden broker-card p-5 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand/12 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-6">
            <div className="max-w-[50ch]">
              <div className="eyebrow">Two minutes to open</div>
              <h2 className="mt-2 text-[21px] font-semibold tracking-tight text-foreground sm:text-[27px]">
                Open your account and look around
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground sm:text-[13.5px]">
                Everything is visible before you commit a rupee. Markets are
                live and the practice book is free.
              </p>
            </div>
            <Link
              href={signupHref}
              className="pressable btn-money inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold sm:h-12 sm:w-auto sm:text-[13.5px]"
            >
              <FiSmartphone size={16} />
              {page.cta}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1100px] px-4 py-6 lg:px-8">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Investments and trading in securities and commodities carry risk of
            loss. Past performance is not indicative of future results. Please
            read all risk disclosures carefully before investing. TradeStox is a
            trading technology platform and does not provide investment advice
            or guaranteed returns.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/partners" className="hover:text-foreground">
              Partner programme
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile sticky CTA. */}
      <div className="sticky bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-xl sm:hidden">
        <Link
          href={signupHref}
          className="pressable btn-money inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold"
        >
          {page.cta}
          <FiArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
