"use client";
import { usePathname } from "next/navigation";

// Auth screens get a stripped layout. The app chrome — nav, ticker tape,
// search, status bar — is noise for someone who has not signed up yet, and on
// a phone it eats most of the viewport (and told visitors "CLOSED · POST-MARKET"
// before they had read a word about the product).
//
// The affiliate surface gets the same treatment for the same reason, plus one
// more: /partners and /l/<slug> are marketing pages that carry their own header,
// footer and call to action. Leaving the trading chrome on them would put two
// navigations on one screen and two competing "sign up" buttons on one page.
const AUTH_PATHS = ["/login", "/signup", "/partners", "/l"];

export default function HideOnAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname() || "";
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`)))
    return null;
  return <>{children}</>;
}
