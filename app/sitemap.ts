import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Only publicly viewable pages. Account, portfolio and admin routes are
// deliberately excluded (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    page("/", 1, "daily"),
    page("/stocks", 0.9, "daily"),
    page("/topmovers", 0.8, "hourly"),
    page("/screener", 0.8, "daily"),
    page("/options", 0.7, "daily"),
    page("/dashboard", 0.6, "daily"),
    page("/watchlist", 0.5, "daily"),
    page("/terms", 0.3, "yearly"),
  ];
}
