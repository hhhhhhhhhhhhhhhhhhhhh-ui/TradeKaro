"use client";

// Reports the top of the funnel: someone heading for the signup form.
//
// One delegated listener rather than a handler on each call to action. The
// landing pages carry three or four of them each — hero, closing panel, sticky
// bar — and wrapping every one by hand means the next CTA somebody adds is
// silently untracked, which is the kind of gap that quietly halves a campaign's
// reported conversion rate.
//
// Fires once per page load. A visitor who clicks "Start Trading Free", goes
// back and clicks it again has expressed the same intent twice; reporting it
// twice inflates the funnel step and teaches the ad platform to chase people who
// are already converting.

import { useEffect } from "react";
import { trackEvent } from "@/app/lib/trackClient";
import { newEventId } from "@/app/lib/trackingEvents";

export default function CtaTracker() {
  useEffect(() => {
    let fired = false;

    const onClick = (ev: MouseEvent) => {
      if (fired) return;
      // Modified clicks open a new tab rather than navigating — still intent.
      const target = ev.target as Element | null;
      const anchor = target?.closest?.('a[href^="/signup"]');
      if (!anchor) return;
      fired = true;
      trackEvent("Lead", { eventId: newEventId() });
    };

    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
