import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Public marketing + market pages are crawlable; anything account-scoped or
// operational is not. The admin console also sets its own noindex metadata.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/profile",
          "/portfolio",
          "/ledger",
          "/settings",
          "/login",
          "/signup",
          "/logout",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
