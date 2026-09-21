"use client";
import { NavTransition } from "./navbar/NavTransition";
import useHasSession from "@/app/hooks/useHasSession";

// Site footer: brand, navigation and the legal line. The full terms live on
// /terms.

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

        <div className="mt-6 flex flex-col gap-1 text-[11px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
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
