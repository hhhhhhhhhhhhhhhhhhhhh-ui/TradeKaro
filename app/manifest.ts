import type { MetadataRoute } from "next";

// Web app manifest — makes TradeStox installable from the browser
// (Add to Home Screen on mobile, Install on desktop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TradeStox — Indian market analysis & trading",
    short_name: "TradeStox",
    description:
      "Live NSE/BSE quotes, charts, options chain and a complete trading terminal.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0a0d10",
    theme_color: "#0a0d10",
    categories: ["finance", "business", "education"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
