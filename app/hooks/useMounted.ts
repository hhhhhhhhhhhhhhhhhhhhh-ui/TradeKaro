"use client";
import { useEffect, useState } from "react";

/**
 * True only from the second client render onward.
 *
 * localStorage is invisible during SSR, so reading it *while rendering* makes
 * the first client pass produce text the server never emitted. React treats
 * that as a hydration mismatch (minified error #418) and throws away the
 * server HTML, re-rendering the whole subtree.
 *
 *   const mounted = useMounted();
 *   const rows = mounted ? getTrades() : [];   // ✅ safe
 *   const rows = typeof window === "undefined" ? [] : getTrades();  // ❌ mismatches
 *
 * `typeof window` is the tempting version and it does not work: on the client
 * it is false during hydration too.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
