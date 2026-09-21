"use client";

// The consent gate. Decides whether this visitor may be tracked, shows the
// banner only to the visitors who are owed one, and mounts the tags only when
// the answer is yes.
//
// WHY THIS IS A CLIENT COMPONENT
//
// The banner's own state depends on a cookie, and reading `document.cookie`
// during render would produce markup that differs from the server's — the
// hydration failure this codebase has already been bitten by. So the server's
// decision (`requiresConsent`, from geolocation) is a prop, and anything that
// depends on the browser is resolved in an effect behind a `mounted` flag.
//
// The consequence is deliberate: nothing renders on the server. A visitor who
// already accepted sees no banner at all — not a flash of one — and a tag can
// never fire before the browser has confirmed consent.

import { useCallback, useEffect, useState } from "react";
import {
  CONSENT_COOKIE,
  CONSENT_TTL_DAYS,
  type ConsentDecision,
} from "@/app/lib/consent";
import TrackingTags from "./TrackingTags";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

export default function ConsentGate({
  requiresConsent,
  partnerPixels = [],
}: {
  /** From geolocation, decided on the server. */
  requiresConsent: boolean;
  /**
   * Pixels belonging to the partner whose code is on this visit, resolved on the
   * server. Ids only — a partner's access token must never reach the client.
   */
  partnerPixels?: Array<{ provider: string; pixelId: string }>;
}) {
  const [mounted, setMounted] = useState(false);
  // Seeded from the prop, which is SSR-safe, then refined by the cookie.
  const [decision, setDecision] = useState<ConsentDecision>(
    requiresConsent ? "denied" : "exempt",
  );
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!requiresConsent) return;
    // No banner is owed here, so tracking is allowed without one.
    const stored = readCookie(CONSENT_COOKIE);
    if (stored === "granted" || stored === "denied") {
      setDecision(stored);
      setAnswered(true);
    }
  }, [requiresConsent]);

  const answer = useCallback((choice: "granted" | "denied") => {
    // First-party, client-readable by design: the banner sets it and the tag
    // gate reads it, with no network round trip in between.
    document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${
      CONSENT_TTL_DAYS * 86400
    }; samesite=lax`;
    setDecision(choice);
    setAnswered(true);

    // Then tell the server, so the click this visitor arrived on carries the
    // decision. Fire-and-forget: the banner must close whether or not this
    // lands, and the cookie above is already doing the work the visitor can see.
    // Phase 4 reads this before forwarding anything to Meta or Google.
    void fetch("/api/track/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: choice }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  const allowed = mounted && (decision === "exempt" || decision === "granted");
  const askNow = mounted && requiresConsent && !answered;

  return (
    <>
      {/* Signal for tests and for anyone reading the markup: whether this
          visitor was in a jurisdiction that requires a banner. Client
          components render on the server too, so this is in the SSR HTML even
          though the banner below is not. */}
      <span hidden data-consent-required={requiresConsent ? "1" : "0"} />

      <TrackingTags
        consent={allowed ? "granted" : "denied"}
        partnerPixels={partnerPixels}
      />

      {askNow ? (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-[60] p-3"
        >
          <div className="broker-card mx-auto max-w-[560px] rounded-2xl border border-border bg-card p-4 shadow-2xl sm:p-5">
            <p className="text-[13.5px] font-semibold text-foreground">
              Cookies for ads and measurement
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              We would like to set cookies that tell us which ads brought people
              here and how the pages perform. The site works either way — you
              can change your mind by clearing cookies.
            </p>

            {/* Equal weight on purpose. A small "reject" link next to a big
                "accept" button is the dark pattern regulators single out, and
                it is the one thing that turns a compliant banner into a
                complaint. Same size, same row, either one ends the question. */}
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => answer("granted")}
                className="pressable btn-money inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-[13px] font-semibold sm:flex-1"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => answer("denied")}
                className="pressable inline-flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card px-5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted sm:flex-1"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
