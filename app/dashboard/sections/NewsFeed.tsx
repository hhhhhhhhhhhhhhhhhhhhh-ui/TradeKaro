"use client";
import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiURL } from "@/app/components/apiURL";
import Loading from "@/app/components/Loading";
import EmptyState from "@/app/dashboard/components/EmptyState";

// Live NSE announcements feed for the dashboard.
export default function NewsFeed() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await axios.post(apiURL + "/announcements");
        const body: any = r.data || {};
        // Accepts { articles[] } and the older { data[] } / { announcements[] }.
        const all: any[] =
          body.articles || body.data || body.announcements || [];
        if (!cancelled) setItems(all.slice(0, 8));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="eyebrow">News · Filings</span>
        <Link
          href="/news"
          className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          VIEW ALL →
        </Link>
      </div>
      {loading ? (
        <div className="py-8 flex justify-center">
          <Loading />
        </div>
      ) : items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No fresh filings"
            hint="NSE announcements will appear here during market hours"
          />
        </div>
      ) : (
        <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
          {items.map((n: any, i: number) => (
            <a
              key={i}
              href={n.url}
              target={n.url ? "_blank" : undefined}
              rel={n.url ? "noreferrer" : undefined}
              className="row-slide block px-4 py-3 hover:bg-muted transition"
            >
              <div className="text-sm font-medium leading-snug line-clamp-2">
                {n.subject || n.desc || n.title || "Announcement"}
              </div>
              <div className="mt-1 truncate text-[11.5px] text-muted-foreground">
                {[
                  n.source?.name,
                  n.symbol || n.scrip,
                  n.publishedAt || n.date || n.dt,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
