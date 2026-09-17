"use client";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { getCookie } from "cookies-next";
import { apiURL } from "@/app/components/apiURL";
import Loading from "@/app/components/Loading";
import useHasSession from "@/app/hooks/useHasSession";

// News, in two layers: what the market is doing, and what the customer holds.
//
// The provider only publishes news BY INSTRUMENT, so "market news" here means
// news about the headline indices, and the personal layer asks about the scrips
// in this account's own paper book. It never asks the provider about
// "positions" — that category describes the linked brokerage account, which is a
// different account entirely.

type Article = {
  subject: string;
  desc: string;
  url: string;
  source?: { name?: string };
  symbol?: string;
  date?: string;
  thumbnail?: string;
  ts?: number | null;
};

function timeAgo(ts?: number | null): string {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function Card({ a }: { a: Article }) {
  const body = (
    <>
      {a.thumbnail ? (
        // Provider thumbnails are on a different host, so a plain <img> is right
        // here — next/image would need that host allow-listed in the config.
        <img
          src={a.thumbnail}
          alt=""
          loading="lazy"
          className="h-16 w-24 shrink-0 rounded-md border border-border object-cover sm:h-20 sm:w-32"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug line-clamp-2">
          {a.subject}
        </div>
        {a.desc ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground line-clamp-2">
            {a.desc}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {a.source?.name ? (
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
              {a.source.name}
            </span>
          ) : null}
          {a.ts ? <span>{timeAgo(a.ts)}</span> : null}
        </div>
      </div>
    </>
  );

  const cls =
    "flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0";
  return a.url ? (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className={`${cls} transition-colors hover:bg-muted`}
    >
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Section(props: {
  title: string;
  hint?: string;
  articles: Article[];
  empty: string;
}) {
  return (
    <section className="broker-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="eyebrow">{props.title}</span>
        {props.hint ? (
          <span className="text-[11px] text-muted-foreground">{props.hint}</span>
        ) : null}
      </div>
      {props.articles.length ? (
        props.articles.map((a, i) => <Card key={`${a.url}-${i}`} a={a} />)
      ) : (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          {props.empty}
        </div>
      )}
    </section>
  );
}

export default function NewsPage() {
  const token = getCookie("token") as string | undefined;
  const hasSession = useHasSession();
  const [market, setMarket] = useState<Article[]>([]);
  const [personal, setPersonal] = useState<Article[]>([]);
  const [scrips, setScrips] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const r = await axios.get(apiURL + "/announcements");
      setMarket(r.data?.articles || []);
      // The API carries a diagnostic `reason` on an empty feed; it is developer
      // detail (sometimes a raw provider dump) so the page shows a plain line.
      if (!r.data?.articles?.length && r.data?.reason) setNote("unavailable");
    } catch {
      setMarket([]);
    }

    if (token) {
      try {
        // Positions come from the server's own ledger, so the news list matches
        // what the customer actually holds rather than the browser's mirror.
        const acc = await axios.get("/api/trade/order", {
          headers: { Authorization: "Bearer " + token },
        });
        const held: string[] = [
          ...new Set(
            (acc.data?.account?.positions || [])
              .filter((p: any) => Number(p?.qty) !== 0)
              .map((p: any) => String(p.scrip || "").toUpperCase())
              .filter(Boolean),
          ),
        ] as string[];
        setScrips(held);
        if (held.length) {
          const n = await axios.get(
            apiURL + `/announcements?symbols=${encodeURIComponent(held.join(","))}`,
          );
          setPersonal(n.data?.articles || []);
        } else {
          setPersonal([]);
        }
      } catch {
        setPersonal([]);
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-8 mb-16">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Market news
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Headlines, plus anything published about what you hold.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loading />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {hasSession ? (
              <Section
                title="From your portfolio"
                hint={
                  scrips.length
                    ? `${scrips.length} scrip${scrips.length === 1 ? "" : "s"}`
                    : undefined
                }
                articles={personal}
                empty={
                  scrips.length
                    ? "Nothing published about your holdings in the last week."
                    : "No open positions yet — news for what you hold will appear here."
                }
              />
            ) : null}

            <Section
              title="Market news"
              hint="largest 15 by liquidity"
              articles={market}
              empty="No market news available right now."
            />

            {note ? (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
                The live news feed could not be reached just now. Nothing is
                cached, so this clears on its own — try Refresh in a minute.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
