"use client";

import { useEffect, useRef } from "react";

/**
 * Fires once when a landing page renders.
 *
 * The page itself is a server component so it is fast and crawlable; the click
 * has to be recorded by a route handler (Node runtime, database access), so this
 * tiny client island exists purely to make that one request.
 *
 * `useRef` guard because React 19 development mode intentionally double-invokes
 * effects — without it every local page view would count as two clicks.
 *
 * `preview` means the visitor is the partner checking their own link. The click
 * is not recorded and no attribution cookie is set, so a partner testing their
 * link no longer quietly worsens their own conversion rate.
 */
export default function TrackClick({
  code,
  slug,
  campaign,
  preview = false,
}: {
  code: string;
  slug: string;
  campaign: string;
  preview?: boolean;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !code) return;
    fired.current = true;
    void fetch("/api/track/click", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, slug, campaign, preview }),
      keepalive: true,
    }).catch(() => undefined);
  }, [code, slug, campaign, preview]);

  return null;
}
