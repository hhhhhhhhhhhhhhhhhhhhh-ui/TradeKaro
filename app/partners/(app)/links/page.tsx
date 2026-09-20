"use client";

// Links — where a partner spends most of their time.
//
// Three questions, in the order a partner asks them, and the page answers them
// in that order:
//
//   1. "What do I send?"        → the short link, copyable and scannable
//   2. "What is working?"       → every campaign and page with people, signups
//                                 and DEPOSITS, not just clicks
//   3. "Is anything happening?" → the last dozen clicks, as they arrive
//
// The two numbers that matter are kept apart everywhere: `Clicks` is every page
// load, `Unique` is the first load per device per day. Showing only the first
// punished a partner for testing their own link.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiCheck,
  FiCopy,
  FiDownload,
  FiExternalLink,
  FiLink2,
  FiPlus,
  FiSend,
  FiTrendingUp,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import { copyText, inr, num, pGet, pPost } from "../../lib/api";
import { usePartner } from "../../lib/store";
import {
  CardSkeleton,
  Empty,
  Notice,
  PageHead,
  Panel,
  PanelHead,
  TRow,
} from "../../lib/ui";
import { Badge } from "@/app/components/ui/kit";

type LP = {
  slug: string;
  title: string;
  headline: string;
  subheadline: string;
  offer: string;
  cta: string;
  tags: string;
  url: string;
  shortUrl: string;
  clicks: number;
  unique: number;
  signups: number;
  deposited: number;
  lastClick: number | null;
  isBest: boolean;
};

type Source = {
  key: string;
  clicks: number;
  unique: number;
  signups: number;
  deposited: number;
  lastClick: number | null;
};

type Recent = {
  ts: number;
  landing: string;
  campaign: string;
  unique: boolean;
  converted: boolean;
  referer: string;
};

type PartnerRequest = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  audience: string;
  status: "open" | "done" | "declined";
  note: string;
  createdAt: number;
  decidedAt: number | null;
};

type Payload = {
  code: string;
  shortCode: string;
  origin: string;
  isLocalhost: boolean;
  landingPages: LP[];
  direct: { url: string; shortUrl: string; clicks: number };
  sources: Source[];
  tags: { tag: string; clicks: number; lastClick: number | null }[];
  recent: Recent[];
  totals: {
    clicks: number;
    unique: number;
    windowClicks: number;
    windowUnique: number;
  };
};

/** "3m", "5h", "2d" — enough to read at a glance in a feed. */
function ago(ts: number | null) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function PartnerLinks() {
  const { toast } = usePartner();
  const [data, setData] = useState<Payload | null>(null);
  const [requests, setRequests] = useState<PartnerRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("start");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showLong, setShowLong] = useState(false);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await pGet<Payload>("/links");
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load your links");
    }
    try {
      const r = await pGet<{ requests: PartnerRequest[] }>("/requests");
      setRequests(r.requests || []);
    } catch {
      /* the request panel is an extra, not a dependency */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(url: string, key: string, label = "Link copied") {
    const ok = await copyText(url);
    if (!ok) {
      toast("Could not copy — long-press to select instead", "err");
      return;
    }
    setCopied(key);
    toast(label, "ok");
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  }

  const page = useMemo(
    () =>
      data?.landingPages.find((p) => p.slug === slug) || data?.landingPages[0],
    [data, slug],
  );

  const tag = campaign.trim().replace(/\s+/g, "-").slice(0, 40);

  /** The shareable form: short domain path, campaign carried through. */
  const shortUrl = useMemo(() => {
    if (!data || !page) return "";
    return `${page.shortUrl}${tag ? `?c=${encodeURIComponent(tag)}` : ""}`;
  }, [data, page, tag]);

  /** The long form, kept for anything that needs it explicit. */
  const longUrl = useMemo(() => {
    if (!data || !page) return "";
    return `${page.url}${tag ? `&c=${encodeURIComponent(tag)}` : ""}`;
  }, [data, page, tag]);

  /** Opening this never counts as a click. */
  const previewUrl = useMemo(
    () => (longUrl ? `${longUrl}&preview=1` : ""),
    [longUrl],
  );

  const qrUrl = useMemo(
    () =>
      `/api/partners/qr?slug=${encodeURIComponent(page?.slug || "start")}${
        tag ? `&c=${encodeURIComponent(tag)}` : ""
      }`,
    [page, tag],
  );

  if (error)
    return (
      <Panel>
        <Empty title="Could not load your links" body={error} />
      </Panel>
    );

  if (!data)
    return (
      <>
        <PageHead eyebrow="Distribution" title="Links & landing pages" />
        <CardSkeleton rows={3} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      </>
    );

  const best = data.landingPages[0];

  return (
    <>
      <PageHead
        eyebrow="Distribution"
        title="Links & landing pages"
        subtitle="Send the short link anywhere. Every visit is counted on our server, so a cleared cookie never loses you a customer."
        right={
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2">
            <div className="text-right">
              <div className="display-num text-[14px] font-semibold leading-none text-foreground">
                {num(data.totals.unique)}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                visitors
              </div>
            </div>
            <span className="h-6 w-px bg-border" />
            <div className="text-right">
              <div className="display-num text-[14px] font-semibold leading-none text-muted-foreground">
                {num(data.totals.clicks)}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                clicks
              </div>
            </div>
          </div>
        }
      />

      {data.isLocalhost ? (
        <div className="mb-4">
          <Notice tone="warn">
            These links point at <strong>localhost</strong>, so they only work
            on this machine. They will switch to the real domain automatically
            once the panel is running on it.
          </Notice>
        </div>
      ) : null}

      {/* ── 1. The link to send ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel className="relative">
          <div className="pointer-events-none absolute -left-14 -top-16 h-44 w-44 rounded-full bg-brand/10 blur-3xl" />
          <PanelHead
            title="Your link"
            hint="Short enough to type, and safe to put in a bio"
          />
          <div className="relative p-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
              <FiZap size={14} className="shrink-0 text-brand" />
              <code className="display-num min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                {shortUrl}
              </code>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => copy(shortUrl, "short", "Link copied")}
                className="pressable btn-money inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-[13px] font-semibold sm:flex-none"
              >
                {copied === "short" ? (
                  <FiCheck size={15} />
                ) : (
                  <FiCopy size={15} />
                )}
                Copy link
              </button>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-4 text-[13px] font-semibold text-foreground"
              >
                <FiExternalLink size={14} />
                Preview
              </a>
              <button
                onClick={() => setShowLong((v) => !v)}
                className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[12.5px] font-semibold text-muted-foreground"
              >
                {showLong ? "Hide long link" : "Long link"}
              </button>
            </div>

            {/* The preview opens ?preview=1, so testing your own link does not
                land in your own numbers. Said out loud, because a partner who
                does not believe it will stop testing their links. */}
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Previewing your own link is not counted as a click — check it as
              often as you like.
            </p>

            {showLong ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {longUrl}
                </code>
                <button
                  onClick={() => copy(longUrl, "long", "Long link copied")}
                  className="pressable grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                  aria-label="Copy the long link"
                >
                  {copied === "long" ? (
                    <FiCheck size={12} className="text-positive" />
                  ) : (
                    <FiCopy size={12} />
                  )}
                </button>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
              <MiniStat label="Visitors" value={num(data.totals.unique)} tone />
              <MiniStat
                label="Signups"
                value={num(
                  data.landingPages.reduce((n, p) => n + p.signups, 0),
                )}
              />
            </div>
          </div>
        </Panel>

        {/* ── QR ────────────────────────────────────────────────────────── */}
        <Panel>
          <PanelHead
            title="QR code"
            hint="For Reels, stories, print and anything offline"
            right={
              <a
                href={qrUrl}
                download={`tradestox-${data.shortCode}-${page?.slug || "start"}.svg`}
                className="pressable inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground"
              >
                <FiDownload size={12} />
                Download
              </a>
            }
          />
          <div className="flex flex-col items-center gap-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={`QR code for ${shortUrl}`}
              width={180}
              height={180}
              className="h-[180px] w-[180px] rounded-xl border border-border bg-white p-2"
            />
            <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
              Points at the link above. Download it as SVG and it stays sharp at
              any size.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── 2. Build a tagged link ─────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Build a tagged link"
          hint="The tag tells you which of your channels sent the visitor"
        />
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Landing page{" "}
              {best?.isBest ? (
                <span className="ml-1 normal-case tracking-normal text-brand">
                  — best performer first
                </span>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data.landingPages.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setSlug(p.slug)}
                  className={`pressable rounded-xl border p-3 text-left transition-colors ${
                    slug === p.slug
                      ? "border-brand/50 bg-brand/8"
                      : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {p.title}
                    </span>
                    {slug === p.slug ? (
                      <FiCheck size={13} className="shrink-0 text-brand" />
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {p.headline}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.isBest ? (
                      <Badge tone="brand">
                        <FiTrendingUp size={10} /> Best
                      </Badge>
                    ) : null}
                    <span className="display-num text-[10.5px] text-muted-foreground">
                      {num(p.unique)} visitors · {num(p.signups)} signups
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Campaign tag
              </span>
              <input
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                list="used-campaign-tags"
                placeholder="instagram-reel-aug"
                maxLength={40}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
              {/* Tags already used, so a partner reuses a spelling instead of
                  inventing `aug` and `august` and splitting their own report. */}
              {data.tags.length ? (
                <datalist id="used-campaign-tags">
                  {data.tags.map((t) => (
                    <option key={t.tag} value={t.tag} />
                  ))}
                </datalist>
              ) : null}
            </label>
            <div className="flex items-end">
              <button
                onClick={() => copy(shortUrl, "builder", "Tagged link copied")}
                className="pressable inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 text-[13px] font-semibold text-background sm:w-auto"
              >
                {copied === "builder" ? (
                  <FiCheck size={15} />
                ) : (
                  <FiCopy size={15} />
                )}
                Copy tagged link
              </button>
            </div>
          </div>

          {data.tags.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                You have used
              </span>
              {data.tags.slice(0, 8).map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => setCampaign(t.tag)}
                  // Without this the accessible name is the tag and the count
                  // run together — "instagram-reel58" — because the visual gap
                  // between them is only CSS. Screen readers need the two
                  // separated and the number named.
                  aria-label={`Use the ${t.tag} campaign tag (${num(
                    t.clicks,
                  )} clicks so far)`}
                  title={`Use the ${t.tag} tag`}
                  className="pressable rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {t.tag}
                  <span className="display-num ml-1.5 text-[10px] opacity-70">
                    {num(t.clicks)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>

      {/* ── 3. What is working ─────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead
            title="By campaign"
            hint="Visitors, signups and deposits per tag"
            right={
              <span className="text-[11px] text-muted-foreground">
                {data.sources.length} source
                {data.sources.length === 1 ? "" : "s"}
              </span>
            }
          />
          {data.sources.length === 0 ? (
            <Empty
              icon={<FiTrendingUp size={18} />}
              title="No clicks yet"
              body="Share a link and this fills in within seconds."
            />
          ) : (
            <>
              <div className="hidden items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:flex">
                <span className="flex-1">Campaign</span>
                <span className="w-16 text-right">Visitors</span>
                <span className="w-14 text-right">Clicks</span>
                <span className="w-16 text-right">Signups</span>
                <span className="w-20 text-right">Deposits</span>
                <span className="w-12 text-right">Last</span>
              </div>
              <div className="divide-y divide-border/60">
                {data.sources.map((s) => (
                  <TRow key={s.key}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-foreground">
                        {s.key}
                      </div>
                      {s.signups > 0 ? (
                        <div className="mt-0.5 text-[10.5px] text-positive">
                          {num(s.signups)} of {num(s.unique)} visitors converted
                        </div>
                      ) : null}
                    </div>
                    <div className="display-num w-16 shrink-0 text-right text-[12.5px] font-semibold text-foreground">
                      {num(s.unique)}
                    </div>
                    <div className="display-num w-14 shrink-0 text-right text-[11.5px] text-muted-foreground">
                      {num(s.clicks)}
                    </div>
                    <div className="display-num w-16 shrink-0 text-right text-[12.5px] text-foreground">
                      {num(s.signups)}
                    </div>
                    <div className="display-num w-20 shrink-0 text-right text-[12.5px] text-foreground">
                      {s.deposited ? inr(s.deposited) : "—"}
                    </div>
                    <div className="w-12 shrink-0 text-right text-[10.5px] text-muted-foreground">
                      {ago(s.lastClick)}
                    </div>
                  </TRow>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel>
          <PanelHead
            title="By landing page"
            hint="Where your traffic actually lands"
          />
          <div className="hidden items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:flex">
            <span className="flex-1">Page</span>
            <span className="w-16 text-right">Visitors</span>
            <span className="w-16 text-right">Signups</span>
            <span className="w-20 text-right">Deposits</span>
            <span className="w-8" />
          </div>
          <div className="divide-y divide-border/60">
            {data.landingPages.map((p) => (
              <TRow key={p.slug}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {p.title}
                    </span>
                    {p.isBest ? (
                      <Badge tone="brand">
                        <FiTrendingUp size={10} /> Best
                      </Badge>
                    ) : null}
                    <span className="rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      /{p.slug}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {p.tags}
                  </div>
                </div>
                <div className="display-num w-16 shrink-0 text-right text-[12.5px] font-semibold text-foreground">
                  {num(p.unique)}
                </div>
                <div className="display-num w-16 shrink-0 text-right text-[12.5px] text-foreground">
                  {num(p.signups)}
                </div>
                <div className="display-num w-20 shrink-0 text-right text-[12.5px] text-foreground">
                  {p.deposited ? inr(p.deposited) : "—"}
                </div>
                <button
                  onClick={() => copy(p.shortUrl, p.slug, "Link copied")}
                  className="pressable grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                  aria-label={`Copy the link for ${p.title}`}
                >
                  {copied === p.slug ? (
                    <FiCheck size={13} className="text-positive" />
                  ) : (
                    <FiCopy size={13} />
                  )}
                </button>
              </TRow>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── 4. Live activity ───────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Recent activity"
          hint="The last dozen visits as they arrive"
          right={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FiActivity size={12} />
              {num(data.totals.windowUnique)} visitors in 30 days
            </span>
          }
        />
        {data.recent.length === 0 ? (
          <Empty
            icon={<FiActivity size={18} />}
            title="Nothing yet"
            body="Open your own link once and you will see it here — that visit is counted, because it is a real visit."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {data.recent.map((r, i) => (
              <TRow key={`${r.ts}-${i}`}>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.unique ? "bg-positive" : "bg-muted-foreground/40"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-foreground">
                    {r.campaign || "direct"}{" "}
                    <span className="text-muted-foreground">
                      → /{r.landing || "start"}
                    </span>
                  </div>
                  {r.referer ? (
                    <div className="truncate text-[10.5px] text-muted-foreground/70">
                      from {r.referer}
                    </div>
                  ) : null}
                </div>
                {r.converted ? (
                  <Badge tone="positive">
                    <FiUsers size={10} /> signed up
                  </Badge>
                ) : null}
                <span className="display-num shrink-0 text-[11px] text-muted-foreground">
                  {ago(r.ts)} ago
                </span>
              </TRow>
            ))}
          </div>
        )}
      </Panel>

      {/* ── 5. How it works + requests ─────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel>
          <PanelHead title="How attribution works" />
          <div className="space-y-3 p-4">
            <Notice>
              A visit is recorded on our server the moment someone opens your
              link. It survives a cleared browser, a private window and a switch
              from mobile to desktop.
            </Notice>
            <ul className="space-y-2.5">
              {[
                [
                  "Visitors, not page loads",
                  "Refreshing your own link does not inflate the number beside someone else's visit — the first visit from one device each day is what counts.",
                ],
                [
                  "60-day window",
                  "A visitor who signs up within 60 days of your click is credited to you.",
                ],
                [
                  "First binding wins",
                  "Attribution is locked at signup. Once a customer belongs to you, no later link can take them away.",
                ],
                [
                  "One owner, permanently",
                  "A customer belongs to exactly one partner, for good.",
                ],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand/12 text-[9px] font-bold text-brand">
                    ✓
                  </span>
                  <span>
                    <span className="block text-[12.5px] font-semibold text-foreground">
                      {t}
                    </span>
                    <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                      {d}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <RequestPanel
          requests={requests}
          open={asking}
          setOpen={setAsking}
          onCreated={(list) => setRequests(list)}
          toast={toast}
        />
      </div>
    </>
  );
}

// ── request a page / creative ───────────────────────────────────────────────

function RequestPanel({
  requests,
  open,
  setOpen,
  onCreated,
  toast,
}: {
  requests: PartnerRequest[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onCreated: (list: PartnerRequest[]) => void;
  toast: (m: string, t?: "ok" | "err" | "info") => void;
}) {
  const [kind, setKind] = useState("landing_page");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const openCount = requests.filter((r) => r.status === "open").length;

  async function submit() {
    setBusy(true);
    try {
      const res = await pPost<{ requests: PartnerRequest[] }>("/requests", {
        kind,
        title,
        detail,
        audience,
      });
      onCreated(res.requests || []);
      setTitle("");
      setDetail("");
      setAudience("");
      setOpen(false);
      toast("Request sent to your account manager", "ok");
    } catch (e: any) {
      toast(e?.message || "Could not send the request", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead
        title="Ask for a page or a creative"
        hint="Goes straight to your account manager, inside the panel"
        right={openCount ? <Badge tone="brand">{openCount} open</Badge> : null}
      />
      <div className="space-y-3 p-4">
        {requests.length ? (
          <div className="flex flex-col gap-2">
            {requests.slice(0, 4).map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border bg-muted/25 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground">
                    {r.title}
                  </span>
                  <Badge
                    tone={
                      r.status === "done"
                        ? "positive"
                        : r.status === "declined"
                          ? "negative"
                          : "neutral"
                    }
                  >
                    {r.status === "done"
                      ? "done"
                      : r.status === "declined"
                        ? "declined"
                        : "open"}
                  </Badge>
                </div>
                {r.note ? (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {r.note}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Need a page for a specific audience, or artwork in a particular
            size? Ask here — it reaches us without leaving the panel.
          </p>
        )}

        {open ? (
          <div className="space-y-2.5 rounded-xl border border-border bg-muted/20 p-3">
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                What do you need?
              </span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <option value="landing_page">A landing page</option>
                <option value="creative">Artwork / creative</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Short title
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Landing page for Hindi beginners"
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Who is it for?
              </span>
              <textarea
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                rows={2}
                maxLength={400}
                className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Anything else
              </span>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={2}
                maxLength={600}
                placeholder="Offer, tone, language, a link to something you liked…"
                className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy || title.trim().length < 4}
                onClick={submit}
                className="pressable inline-flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-[12.5px] font-semibold text-background disabled:opacity-50"
              >
                <FiSend size={14} />
                {busy ? "Sending…" : "Send request"}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="pressable inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-[12.5px] font-semibold text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-[12.5px] font-semibold text-foreground"
          >
            <FiPlus size={14} />
            New request
          </button>
        )}
      </div>
    </Panel>
  );
}

function MiniStat({
  label,
  value,
  tone = false,
}: {
  label: string;
  value: string;
  tone?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`display-num mt-0.5 text-[17px] font-semibold ${
          tone ? "text-foreground" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
