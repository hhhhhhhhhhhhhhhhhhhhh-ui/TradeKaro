"use client";
import { usePathname } from "next/navigation";

// Auth screens get a stripped layout. The app chrome — nav, ticker tape,
// search, status bar — is noise for someone who has not signed up yet, and on
// a phone it eats most of the viewport (and told visitors "CLOSED · POST-MARKET"
// before they had read a word about the product).
const AUTH_PATHS = ["/login", "/signup"];

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
