// Firing an event from the browser.
//
// Deliberately thin: it calls whatever the platform exposed and does nothing at
// all when nothing did. That absence IS the consent gate — Meta's pixel is never
// loaded without permission, so `window.fbq` simply does not exist and the call
// is a no-op. There is no second consent check here to drift out of sync with
// the first one.
//
// Google is the exception it has to be: gtag always loads and is told the truth
// through Consent Mode, so it is present even when the answer was no. It honours
// that itself — the event is sent without identifiers rather than not sent,
// which is the behaviour Consent Mode exists to provide.

import {
  CURRENCY,
  PROVIDER_EVENT,
  type CanonicalEvent,
} from "./trackingEvents";

type TrackParams = {
  /** Shared with the server-side copy so the platforms collapse the pair. */
  eventId?: string;
  value?: number;
  currency?: string;
};

/** Minimal shapes — the real globals are untyped vendor scripts. */
type Fbq = (
  cmd: string,
  name: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) => void;
type Gtag = (...args: unknown[]) => void;

export function trackEvent(name: CanonicalEvent, p: TrackParams = {}) {
  if (typeof window === "undefined") return;

  const map = PROVIDER_EVENT[name];
  const payload: Record<string, unknown> = {};
  if (typeof p.value === "number" && Number.isFinite(p.value))
    payload.value = p.value;
  payload.currency = p.currency || CURRENCY;

  const w = window as unknown as { fbq?: Fbq; gtag?: Gtag };

  // Meta takes the dedup id as a fourth argument, and only as an object.
  if (typeof w.fbq === "function")
    w.fbq(
      "track",
      map.meta,
      payload,
      p.eventId ? { eventID: p.eventId } : undefined,
    );

  // Google wants the same idea under a different name.
  if (typeof w.gtag === "function")
    w.gtag("event", map.ga4, {
      ...payload,
      ...(p.eventId ? { transaction_id: p.eventId } : {}),
    });
}
