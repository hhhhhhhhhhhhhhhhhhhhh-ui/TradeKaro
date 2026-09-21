import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  FiActivity,
  FiArrowRight,
  FiCheckCircle,
  FiLayers,
  FiShield,
} from "react-icons/fi";
import { affiliateByCode, landingPage } from "@/app/lib/affiliates";
import { pickSignals } from "@/app/lib/tracking";
import {
  consentRequiredForCountry,
  countryFromHeaders,
} from "@/app/lib/consent";
import { publicPixelsForCode } from "@/app/lib/pixels";
import ConsentGate from "@/app/components/consent/ConsentGate";
import CtaTracker from "@/app/components/consent/CtaTracker";
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
  searchParams: Promise<{
    ref?: string;
    c?: string;
    preview?: string;
    // Ad click ids and utm params arrive as arbitrary strings. They are read
    // through the allowlist in `lib/tracking.ts`, never used directly.
    [key: string]: string | string[] | undefined;
  }>;
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
  const sp = await searchParams;
  const { ref = "", c = "", preview = "" } = sp;
  const isPreview = preview === "1" || preview === "true";

  // Snapshot the ad click ids off the URL the visitor actually landed on. This
  // is the only moment they exist — a later navigation drops them, and the
  // pixels that will consume them do not exist yet. See `lib/tracking.ts`.
  const signals = pickSignals(sp);

  // Where the visitor is decides whether they are owed a cookie banner. Read on
  // the server so the tag gate can be told the answer in the first render,
  // rather than asking the browser and firing pixels while it waits.
  // This page is already force-dynamic, so reading headers costs nothing extra.
  const requiresConsent = consentRequiredForCountry(
    countryFromHeaders(await headers()),
  );

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
      <ConsentGate
        requiresConsent={requiresConsent}
        partnerPixels={code ? publicPixelsForCode(code) : []}
      />
      <CtaTracker />

      {valid ? (
        <TrackClick
          code={code}
          slug={page.slug}
          campaign={campaign}
          preview={isPreview}
          signals={signals}
        />
      ) : null}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-2.5 sm:max-w-3xl sm:px-6">
          <div className="flex items-center gap-2.5">
            {/* .brand-panel, not .brand-gradient: the lime end of that gradient
                sits under this white "TS" and measured 1.98:1. */}
            <span className="brand-panel grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[13px] font-black text-brand-foreground">
              TS
            </span>
            <span className="leading-tight">
              <span className="block text-[14.5px] font-semibold tracking-tight text-foreground">
                TradeStox
              </span>
              <span className="block text-[10.5px] text-muted-foreground">
                {page.tags || "Indian markets"}
              </span>
            </span>
          </div>
          <Link
            href="/login"
            className="pressable inline-flex min-h-[44px] items-center rounded-full border border-border px-4 text-[13px] font-medium text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* One narrow measure for the whole page.
          On a 390px phone the constraint does nothing; on a desktop it is what
          stops a mobile-first page stretching into a wall of 140-character
          lines. Every section below therefore carries no horizontal padding of
          its own — this supplies it, and the sections only divide. */}
      <div className="mx-auto max-w-lg px-4 sm:max-w-3xl sm:px-6">
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="pb-8 pt-7 sm:pb-12 sm:pt-14">
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span className="text-[11px] text-muted-foreground">
              {page.tags || "Live markets"}
            </span>
          </div>

          {/* display-num is the mono face: it gives the headline a terminal
            character without a panel or a gradient to carry it. */}
          <h1 className="display-num mt-4 text-[32px] leading-[1.08] text-foreground sm:text-5xl">
            {page.headline}
          </h1>

          {page.subheadline ? (
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground sm:text-base">
              {page.subheadline}
            </p>
          ) : null}

          {page.offer ? (
            <div className="broker-card mt-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
              <span className="text-[12px] font-medium text-brand">
                {page.offer}
              </span>
            </div>
          ) : null}

          {/* Full-width on a phone: thumbs, not cursors. 52px tap targets, one
            clear primary action, the secondary directly below it. */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={signupHref}
              className="pressable btn-money flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold sm:w-auto sm:px-8"
            >
              {page.cta}
              <FiArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="pressable flex h-[52px] w-full items-center justify-center rounded-2xl border border-border text-[14px] font-medium text-foreground sm:w-auto sm:px-8"
            >
              I already have an account
            </Link>
          </div>
        </section>

        {/* ── This page's own selling points ──────────────────────────────────
          Two columns on a phone, not one: a single column of four bullets is a
          long grey wall at 390px, and tiles read as a feature set instead. */}
        {page.highlights.length ? (
          <section className="border-t border-border py-7 sm:py-10">
            <p className="eyebrow text-muted-foreground">Why traders switch</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {page.highlights.map((h) => (
                <div key={h} className="broker-card rounded-2xl p-3.5">
                  <FiCheckCircle className="h-4 w-4 text-brand" />
                  <p className="mt-2 text-[13px] leading-snug text-foreground">
                    {h}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Proof points ────────────────────────────────────────────────── */}
        <section className="border-t border-border py-7 sm:py-10">
          <p className="eyebrow text-muted-foreground">
            Built for the desk, not a demo
          </p>
          {/* Stacked, not a grid. Three cards across reads as a comparison
            table at this width; one per row reads as an argument. */}
          <div className="mt-4 flex flex-col gap-3">
            {[
              [
                <FiActivity key="a" className="h-5 w-5 text-brand" />,
                "Charts that hold up under pressure",
                "Live depth, multi-timeframe candles and a payoff builder for options, all on one screen you can actually read on a phone.",
              ],
              [
                <FiLayers key="b" className="h-5 w-5 text-brand" />,
                "NSE, BSE and MCX in one terminal",
                "One watchlist, one login, one order window across equities, futures, options and commodities. No app-switching mid-trade.",
              ],
              [
                <FiShield key="c" className="h-5 w-5 text-brand" />,
                "Your money, your name, your account",
                "Withdrawals settle only to a bank or UPI account registered in your own name — no third-party payouts, no exceptions.",
              ],
            ].map(([icon, title, body]) => (
              <div key={String(title)} className="broker-card rounded-2xl p-4">
                {icon as React.ReactNode}
                <p className="mt-2.5 text-[14px] font-semibold text-foreground">
                  {title as string}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {body as string}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────────
          Three steps, because on a phone the visitor's real question is not
          "what does it do" but "how much of my evening does this cost me". */}
        <section className="border-t border-border py-7 sm:py-10">
          <p className="eyebrow text-muted-foreground">
            From signup to your first trade
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {[
              [
                "1",
                "Create your account",
                "Name, email, mobile number. About two minutes on a phone.",
              ],
              [
                "2",
                "Add funds",
                "UPI or netbanking. Add money when you are ready — the practice book needs none.",
              ],
              [
                "3",
                "Place your first trade",
                "Try it risk-free first in the practice book with virtual money and live prices, or go live.",
              ],
            ].map(([n, t, d]) => (
              <div key={n} className="broker-card flex gap-3 rounded-2xl p-4">
                <span className="display-num shrink-0 text-2xl text-brand">
                  {n}
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">
                    {t}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {d}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Closing CTA ─────────────────────────────────────────────────── */}
        <section className="border-t border-border py-8 sm:py-12">
          <div className="broker-card rounded-2xl p-6 text-center sm:p-10">
            <h2 className="text-[22px] font-semibold leading-snug text-foreground sm:text-3xl">
              Your next trade is a tap away
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground sm:text-base">
              Open the account, take the practice credit and place a trade.
              Nothing here is hidden behind a deposit.
            </p>
            <Link
              href={signupHref}
              className="pressable btn-money mt-6 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold sm:w-auto sm:px-10"
            >
              {page.cta}
              <FiArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-3xl sm:px-6">
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
