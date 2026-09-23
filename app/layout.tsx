import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "sileo";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import Navbar from "./components/navbar/Navbar";
import TickerTape from "./components/TickerTape";
import AdminBanner from "./components/AdminBanner";
import StatusBar from "./components/StatusBar";
import MobileBottomNav from "./components/MobileBottomNav";
import CommandPalette from "./components/CommandPalette";
import TradeEngine from "./components/TradeEngine";
import ClientHeartbeat from "./components/ClientHeartbeat";
import Footer from "./components/Footer";
import HideOnAdmin from "./components/HideOnAdmin";
import HideOnAuth from "./components/HideOnAuth";

// Vercel Web Analytics only exists on Vercel. Loading it anywhere else 404s on
// /_vercel/insights/script.js and logs a console error on every single page.
const onVercel = Boolean(
  process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_ENV,
);

export const metadata: Metadata = {
  // Absolute URLs for OG/Twitter images and canonical links. Set
  // NEXT_PUBLIC_SITE_URL in the host environment (falls back to localhost).
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: "TradeStox",
  description:
    "Indian stock market analysis and trading — live NSE/BSE quotes, charts, options chain and portfolio tracking.",
  applicationName: "TradeStox",
  openGraph: {
    type: "website",
    siteName: "TradeStox",
    title: "TradeStox — Indian market analysis & trading",
    description:
      "Live NSE/BSE quotes, charts, options chain and a complete trading account.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e11" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${jetbrainsMono.variable} font-sans`}
      >
        {/* Applies the stored theme before first paint so there is no flash of
            the wrong palette. Keep in sync with components/theme/ThemeProvider. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");document.documentElement.classList.toggle("dark",t?t==="dark":true)}catch(e){document.documentElement.classList.add("dark")}})();`,
          }}
        />
        <ThemeProvider>
          <div className="flex flex-col min-h-screen bg-background overflow-x-hidden">
            <HideOnAdmin>
              <HideOnAuth>
                <div className="px-4 sm:px-6 lg:px-8">
                  <div className="max-w-7xl mx-auto">
                    <Navbar logStatus={true} />
                  </div>
                </div>
              </HideOnAuth>
            </HideOnAdmin>
            <HideOnAdmin>
              <HideOnAuth>
                <TickerTape />
              </HideOnAuth>
            </HideOnAdmin>
            <AdminBanner />
            <ClientHeartbeat />
            <main className="flex-grow pb-[96px] md:pb-12 scroll-mt-20">
              {children}
            </main>
            <HideOnAdmin>
              <HideOnAuth>
                <Footer />
              </HideOnAuth>
            </HideOnAdmin>
            <HideOnAdmin>
              <HideOnAuth>
                <TradeEngine />
              </HideOnAuth>
            </HideOnAdmin>
            <HideOnAdmin>
              <HideOnAuth>
                <StatusBar />
              </HideOnAuth>
            </HideOnAdmin>
            <HideOnAdmin>
              <HideOnAuth>
                <MobileBottomNav />
              </HideOnAuth>
            </HideOnAdmin>
            <HideOnAdmin>
              <HideOnAuth>
                <CommandPalette />
              </HideOnAuth>
            </HideOnAdmin>
          </div>
          {/* Appearance lives in globals.css under "sileo toasts" so it can use the
              theme tokens and respond to .dark. Only geometry is set here.

              The old config passed `fill: "#171717"` plus a `styles{}` block. The
              fill hardcoded a near-black pill in BOTH themes, and the block was
              dead config — its classes use Tailwind v4's suffix-! syntax
              (`text-white!`, `rounded-[16px]!`) on a v3 project, so no CSS was
              generated and the title silently fell back to sileo's own oklch
              green. Both are replaced. */}
          <Toaster
            position="bottom-right"
            offset={16}
            options={{ roundness: 12 }}
          />
          {onVercel ? <Analytics /> : null}
        </ThemeProvider>
      </body>
    </html>
  );
}
