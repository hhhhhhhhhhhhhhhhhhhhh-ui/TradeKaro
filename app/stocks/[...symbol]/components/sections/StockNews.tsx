"use client";
import axios from "axios";
import { apiURL } from "@/app/components/apiURL";
import { useEffect, useState } from "react";
import Loading from "@/app/components/Loading";

// NSE announcements filtered to this scrip.
export default function StockNews(props: { symbol: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function load() {
      try {
        const r = await axios.post(apiURL + "/announcements");
        const body: any = r.data || {};
        const all: any[] =
          body.articles || body.data || body.announcements || [];
        setItems(
          all
            .filter((n: any) =>
              JSON.stringify(n)
                .toUpperCase()
                .includes(props.symbol.toUpperCase()),
            )
            .slice(0, 8),
        );
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [props.symbol]);
  if (loading)
    return (
      <div className="py-6 flex justify-center">
        <Loading />
      </div>
    );
  if (!items.length)
    return (
      <div className="broker-card p-6 text-[13px] text-muted-foreground">
        No recent filings for {props.symbol}.
      </div>
    );
  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border px-6 py-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        News · {props.symbol}
      </div>
      {items.map((n: any, i: number) => (
        <a
          key={i}
          href={n.url}
          target={n.url ? "_blank" : undefined}
          rel={n.url ? "noreferrer" : undefined}
          className="block px-6 py-3 border-b border-border last:border-0 text-sm hover:bg-muted transition"
        >
          <div className="font-medium">
            {n.subject || n.desc || n.title || "Announcement"}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {[n.source?.name, n.publishedAt || n.date || n.dt]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </a>
      ))}
    </div>
  );
}
