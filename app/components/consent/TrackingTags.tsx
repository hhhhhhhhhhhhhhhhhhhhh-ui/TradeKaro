"use client";

// The platform pixels: Meta and GA4.
//
// Both are inert until their id is configured in the environment, because a
// tracking tag that fires the moment it is merged is a tag nobody agreed to.
// With no `NEXT_PUBLIC_META_PIXEL_ID` / `NEXT_PUBLIC_GA_MEASUREMENT_ID` set,
// this renders nothing at all — which is also what keeps local development and
// the test suite free of phantom network calls.
//
// GOOGLE IS NOT TREATED THE SAME AS META, AND THAT IS INTENTIONAL
//
// Google Consent Mode v2 wants the tag to be LOADED with consent signalled as
// denied, so that EEA traffic still produces modelled conversions and Google
// Ads keeps serving. Meta has no equivalent: the right thing there is simply to
// not load the pixel until consent exists.
//
// So gtag loads either way with the signal set to the truth, and the Meta pixel
// only loads when permission was actually given.

import Script from "next/script";
import { useEffect, useRef } from "react";

const META_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "";
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "";

export type PartnerPixel = { provider: string; pixelId: string };

export default function TrackingTags({
  consent,
  partnerPixels = [],
}: {
  /** `granted` only when the visitor may be tracked — exempt regions included. */
  consent: "granted" | "denied";
  /** Pixels belonging to the partner whose link this visitor arrived on. */
  partnerPixels?: PartnerPixel[];
}) {
  const granted = consent === "granted";

  const partnerMeta = partnerPixels
    .filter((p) => p.provider === "meta")
    .map((p) => p.pixelId);
  const partnerGa = partnerPixels
    .filter((p) => p.provider === "ga4")
    .map((p) => p.pixelId);

  // The Meta loader, split from the platform's own init.
  //
  // A partner's pixel CANNOT fire on its own: `fbq` is a function that
  // fbevents.js defines, so without the loader there is nothing to call. The
  // first version of this gated the loader on META_ID alone, which meant that on
  // a deployment with no platform Meta pixel a partner could add theirs, be told
  // it saved, see it listed as active — and have it never fire once, with no
  // error anywhere to explain why. The GA4 side already loaded its library for a
  // partner-only property; this is the same rule applied to Meta.
  const metaBase = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');`;
  const metaSnippet = `${metaBase}${
    META_ID ? `fbq('init','${META_ID}');fbq('track','PageView');` : ""
  }`;

  // One gtag block for every GA4 property, platform and partner alike.
  //
  // Consent defaults have to be set before the first `config`, and separate
  // Script tags are not guaranteed to execute in the order they appear — so
  // splitting partner configs into their own tags risked configuring a property
  // before the default was declared, which is exactly the state Consent Mode
  // exists to prevent.
  const gaPartnerConfigs = granted
    ? partnerGa
        .map((gid) => `gtag('config','${gid}',{anonymize_ip:true});`)
        .join("\n")
    : "";
  const gaSnippet = `window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{
  ad_storage:'${granted ? "granted" : "denied"}',
  ad_user_data:'${granted ? "granted" : "denied"}',
  ad_personalization:'${granted ? "granted" : "denied"}',
  analytics_storage:'${granted ? "granted" : "denied"}',
  wait_for_update:500
});
gtag('js',new Date());${GA_ID ? `\ngtag('config','${GA_ID}');` : ""}${
    gaPartnerConfigs ? `\n${gaPartnerConfigs}` : ""
  }`;

  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !granted || !partnerMeta.length) return;
    ran.current = true;
    // The partner's pixel is initialised after the base library has loaded. `fbq`
    // is only defined once that has happened, so this polls briefly rather than
    // assuming an order the browser does not guarantee.
    const ids = partnerMeta;
    let tries = 0;
    const tick = () => {
      const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void })
        .fbq;
      if (typeof fbq === "function") {
        for (const pid of ids) {
          fbq("init", pid);
          fbq("track", "PageView");
        }
        return;
      }
      if (tries++ < 40) setTimeout(tick, 250);
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted, partnerMeta.join(",")]);

  return (
    <>
      {/* Loaded when EITHER the platform or a partner needs it — see metaBase. */}
      {(META_ID || partnerMeta.length) && granted ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {metaSnippet}
        </Script>
      ) : null}

      {GA_ID || (granted && partnerGa.length) ? (
        <Script id="ga4" strategy="afterInteractive">
          {gaSnippet}
        </Script>
      ) : null}

      {/* Loaded after the consent defaults above, never before: gtag.js reads
          the default as it initialises, so a bundle that arrives first reports
          whatever the visitor has not yet agreed to. Also loaded when a partner
          has a GA4 property but we have none of our own. */}
      {GA_ID || (granted && partnerGa.length) ? (
        <Script
          id="ga4-lib"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${
            GA_ID || partnerGa[0]
          }`}
        />
      ) : null}
    </>
  );
}
