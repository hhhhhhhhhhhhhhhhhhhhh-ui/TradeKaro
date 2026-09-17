import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Console · TradeKaro Admin",
  description: "Restricted operations console.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Standalone corporate shell: no ticker tape, no storefront nav. Uses the
  // app's theme tokens so it follows light/dark instead of a hardcoded palette.
  return (
    <div className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </div>
  );
}
