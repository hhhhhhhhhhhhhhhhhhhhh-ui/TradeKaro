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
      <header className="border-b border-border bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 px-4 py-3 lg:px-8">
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

        <div className="relative mx-auto max-w-[1100px] px-4 pb-12 pt-12 lg:px-8 lg:pb-20 lg:pt-20">
          <div className="eyebrow flex items-center gap-2">
            <span className="live-dot" />
            {page.tags || "Live markets"}
          </div>

          <h1 className="mt-4 max-w-[20ch] text-[34px] font-semibold leading-[1.07] tracking-tight text-foreground sm:text-[46px] lg:text-[58px]">
            {page.headline}
          </h1>

          {page.subheadline ? (
            <p className="mt-4 max-w-[62ch] text-[14.5px] leading-relaxed text-muted-foreground sm:text-[16.5px]">
              {page.subheadline}
            </p>
          ) : null}

          {page.offer ? (
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/8 px-3.5 py-1.5 text-[12px] font-semibold text-brand">
              <FiCheckCircle size={14} />
              {page.offer}
            </div>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={signupHref}
              className="pressable btn-money inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[13.5px] font-semibold"
            >
              {page.cta}
              <FiArrowRight size={15} />
            </Link>
            <Link
              href="/login"
              className="pressable inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-6 text-[13.5px] font-semibold text-foreground"
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

      {/* ── Proof points ────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid max-w-[1100px] gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:px-8">
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
              "Your money, guarded",
              "Withdrawals go only to the bank or UPI account you registered. Add a new one and withdrawals pause until it is verified.",
            ],
          ].map(([icon, title, body]) => (
            <div
              key={String(title)}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">
                {icon as React.ReactNode}
              </span>
              <div className="mt-3 text-[13.5px] font-semibold text-foreground">
                {title as string}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {body as string}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1100px] px-4 py-14 lg:px-8">
        <div className="relative overflow-hidden broker-card p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand/12 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-[50ch]">
              <div className="eyebrow">Two minutes to open</div>
              <h2 className="mt-2 text-[23px] font-semibold tracking-tight text-foreground sm:text-[27px]">
                Open your account and look around
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                Everything is visible before you commit a rupee. Markets are
                live and the practice book is free.
              </p>
            </div>
            <Link
              href={signupHref}
              className="pressable btn-money inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[13.5px] font-semibold"
            >
              <FiSmartphone size={15} />
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
