"use client";
import { NavTransition } from "./navbar/NavTransition";
import useHasSession from "@/app/hooks/useHasSession";

// Site footer: the one place the platform states plainly what it is. Every
// other surface uses normal trading language, so this has to be unmissable
// rather than buried — see /terms for the full disclosure.

// `auth: true` entries are account pages: they bounce a visitor to /login, so
// advertising them here would only send people in circles.
const LINKS = [
  { label: "Dashboard", href: "/dashboard", auth: true },
  { label: "Stocks", href: "/stocks" },
  { label: "Options", href: "/options" },
  { label: "Positions", href: "/positions", auth: true },
  { label: "Connect account", href: "/connect", auth: true },
  { label: "Terms & risk", href: "/terms" },
];

export default function Footer() {
  const hasSession = useHasSession();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/TradeStoxLogo.png"
              alt=""
              className="h-8 w-8 rounded-lg"
            />
            <div>
              <div className="text-[14px] font-semibold tracking-tight">
                TradeStox
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                NSE/BSE market analysis &amp; trading terminal
              </div>
            </div>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]"
          >
            {LINKS.filter((l) => !l.auth || hasSession).map((l) => (
              <NavTransition
                key={l.href}
                href={l.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </NavTransition>
            ))}
          </nav>
        </div>

        {/* The disclosure. Short on purpose: one clear statement beats a wall of
            small print nobody reads.

            ⚠️ It has to be TRUE. This platform takes real money in and pays
            real money out through a payment gateway, while order execution is
            simulated on our own book. The old "no real funds are held or
            moved … simulated credits for evaluation only" text stopped being
            true the moment the payment rail went live, and a false risk
            disclosure is worse than none at all — it is also the kind of claim
            a regulator reads as misrepresentation of the product. */}
        <p className="mt-6 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">
            Real money, simulated execution.
          </span>{" "}
          Wallet deposits and withdrawals are real funds, collected and paid out
          through our payment partner. Orders are matched on our own book and
          are never placed with an exchange or broker, so positions and trading
          profit or loss are notional and do not reduce or increase your wallet
          balance. Nothing here is investment advice. See{" "}
          <NavTransition
            href="/terms"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Terms &amp; risk disclosure
          </NavTransition>
          .
        </p>

        <div className="mt-5 flex flex-col gap-1 text-[11px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} TradeStox. Market data via Upstox.
          </span>
          <span>
            Prices are indicative and may differ from the exchange feed.
          </span>
        </div>
      </div>
    </footer>
  );
}
