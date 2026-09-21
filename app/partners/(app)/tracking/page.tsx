"use client";

// Tracking — a partner's own pixels.
//
// WHY THIS EXISTS
//
// A partner spends their own money on ads. Without their pixel on these pages
// they can see clicks but never learn which ad set produced a signup or a
// deposit, so they cannot optimise and they stop spending. This is the single
// most-requested thing in any affiliate programme, and the reason it is worth
// the trouble is that "we can tell you which of your campaigns pays" is a
// stronger retention argument than any commission rate.
//
// WHAT THEY MAY AND MAY NOT ENTER
//
// A PIXEL ID ONLY. No script tags, no HTML, no custom code — however often
// somebody asks. A pixel id is rendered into an inline script on our origin, and
// a partner is an untrusted input path: a "custom script" field would be stored
// XSS against every visitor who arrived through their link, using our cookies.
// The server validates the id against a strict shape for exactly this reason;
// this form does not get to loosen that.

import { useEffect, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiCopy,
  FiEye,
  FiRefreshCw,
  FiTrash2,
} from "react-icons/fi";
import { copyText, pDelete, pGet, pPost } from "../../lib/api";
import { usePartner } from "../../lib/store";
import { Badge } from "@/app/components/ui/kit";
import { CardSkeleton, Notice, PageHead, Panel, PanelHead } from "../../lib/ui";

type Pixel = {
  provider: "meta" | "ga4";
  pixelId: string;
  label: string;
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  updatedAt: number;
};

type Payload = {
  pixels: Pixel[];
  serverSideAvailable: boolean;
  platformConfigured: { meta: boolean; ga4: boolean };
};

const META_HELP =
  "Events Manager → Data sources → your pixel. The ID is the long number, not the name.";
const GA4_HELP =
  "Admin → Data streams → your web stream. It looks like G-XXXXXXXX.";

export default function PartnerTracking() {
  const { toast } = usePartner();
  const [data, setData] = useState<Payload | null>(null);
  const [provider, setProvider] = useState<"meta" | "ga4">("meta");
  const [pixelId, setPixelId] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<null | {
    endpoint: string;
    authorizationHeader: string;
    payload: unknown;
  }>(null);

  const load = () =>
    pGet<Payload>("/pixels")
      .then((d) => setData(d))
      .catch(() => undefined);

  useEffect(() => {
    load();
  }, []);

  const current = data?.pixels.find((p) => p.provider === provider);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await pPost("/pixels", {
        provider,
        pixelId,
        // Only sent when the partner actually typed one. An empty field must not
        // erase a stored token — the form cannot show it back, so a save with
        // the box untouched would otherwise silently wipe a working credential.
        ...(token.trim() ? { token } : {}),
      });
      toast("Pixel saved", "ok");
      setToken("");
      setPixelId("");
      setPreview(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not save that pixel");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Pixel) {
    if (
      !window.confirm(
        `Remove your ${p.provider === "meta" ? "Meta" : "GA4"} pixel?`,
      )
    )
      return;
    setBusy(true);
    try {
      await pDelete(`/pixels?provider=${p.provider}`);
      toast("Pixel removed", "ok");
      setPreview(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not remove that pixel");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const res = await pPost<any>("/pixels?dryRun=1", {});
      setPreview(res);
    } catch (e: any) {
      setError(e?.message || "Nothing to check yet");
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <>
        <PageHead eyebrow="Attribution" title="Your tracking pixels" />
        <CardSkeleton rows={3} />
      </>
    );

  return (
    <>
      <PageHead
        eyebrow="Attribution"
        title="Your tracking pixels"
        subtitle="Add your own pixel and we will report signups and deposits into your ad account, so you can see which of your campaigns actually pays."
      />

      {/* Two halves of one thing, and partners consistently expect only the
          first. Said plainly because the second is what makes their ad platform
          optimise against deposits rather than clicks. */}
      <div className="mb-4">
        <Notice>
          <strong>Both halves are optional and independent.</strong> The pixel
          ID alone puts your pixel on our landing pages — that is enough to see
          visitors and signups. Adding an access token as well lets us report
          conversions <em>server-side</em>, which is what survives iOS, ad
          blockers and a closed browser tab.
        </Notice>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHead
            title={current ? "Replace your pixel" : "Add a pixel"}
            hint="Meta first — Google needs more setup on your side"
          />

          <div className="space-y-4 p-4">
            <div>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Provider
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["meta", "ga4"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setProvider(p);
                      setPixelId("");
                      setToken("");
                      setPreview(null);
                      setError(null);
                    }}
                    className={`pressable rounded-xl border p-2.5 text-[12.5px] font-semibold ${
                      provider === p
                        ? "border-brand/50 bg-brand/8 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {p === "meta" ? "Meta / Facebook" : "Google Analytics 4"}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {provider === "meta" ? "Pixel ID" : "Measurement ID"}
              </span>
              <input
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
                placeholder={
                  provider === "meta" ? "1234567890123456" : "G-XXXXXXXXXX"
                }
                inputMode={provider === "meta" ? "numeric" : "text"}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                {provider === "meta" ? META_HELP : GA4_HELP}
              </span>
            </label>

            {provider === "meta" ? (
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Conversions API token{" "}
                  <span className="normal-case tracking-normal opacity-70">
                    (optional)
                  </span>
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    type={showToken ? "text" : "password"}
                    autoComplete="off"
                    placeholder={
                      current?.hasToken
                        ? `Saved ${current.tokenHint}`
                        : "Paste your token"
                    }
                    className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? "Hide token" : "Show token"}
                    className="pressable grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
                  >
                    <FiEye size={15} />
                  </button>
                </div>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  Events Manager → Settings → Conversions API → Generate access
                  token. Stored encrypted; we never show it back and never share
                  it.
                </span>
              </label>
            ) : null}

            {!data.serverSideAvailable && provider === "meta" ? (
              <Notice tone="warn">
                Server-side sending is not available on this platform right now,
                so a token cannot be stored. Your pixel ID still works.
              </Notice>
            ) : null}

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/10 p-3 text-[12px] text-negative">
                <FiAlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy || !pixelId.trim()}
                className="pressable btn-money inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-semibold disabled:opacity-50 sm:flex-none"
              >
                <FiCheck size={15} />
                {current ? "Replace" : "Save pixel"}
              </button>
              {current?.hasToken ? (
                <button
                  type="button"
                  onClick={check}
                  disabled={busy}
                  className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[12.5px] font-semibold text-foreground disabled:opacity-50"
                >
                  <FiRefreshCw size={14} />
                  Check what we send
                </button>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="What is set up"
            hint="Your pixels, and how far each one goes"
          />
          {data.pixels.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-[13px] font-semibold text-foreground">
                No pixels yet
              </p>
              <p className="mx-auto mt-1 max-w-[36ch] text-[12px] leading-relaxed text-muted-foreground">
                Your links work without one. You just will not be able to tell
                which campaigns produced signups.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {data.pixels.map((p) => (
                <div key={p.provider} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-foreground">
                        {p.provider === "meta" ? "Meta" : "GA4"}
                      </span>
                      {p.hasToken ? (
                        <Badge tone="positive">
                          <FiCheck size={10} /> server-side
                        </Badge>
                      ) : (
                        <Badge tone="neutral">browser only</Badge>
                      )}
                      {!p.enabled ? <Badge tone="neutral">paused</Badge> : null}
                    </div>
                    <div className="display-num mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {p.pixelId}
                    </div>
                    {p.hasToken ? (
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                        token saved {p.tokenHint}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground/80">
                        Add a token to also report conversions from our servers.
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyText(p.pixelId);
                        toast(
                          ok ? "Pixel ID copied" : "Could not copy",
                          ok ? "ok" : "err",
                        );
                      }}
                      aria-label={`Copy the ${p.provider} pixel ID`}
                      className="pressable grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                    >
                      <FiCopy size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      disabled={busy}
                      aria-label={`Remove the ${p.provider} pixel`}
                      className="pressable grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-negative disabled:opacity-50"
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {preview ? (
            <div className="border-t border-border/60 p-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                What we would send
              </div>
              <div className="display-num mt-2 break-all rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] text-foreground">
                {preview.endpoint}
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                Authorization: {preview.authorizationHeader}
              </div>
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-background p-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
                {JSON.stringify(preview.payload, null, 2)}
              </pre>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                This is a preview. Nothing was sent — a test conversion in your
                ad account would spend your budget and teach it something
                untrue.
              </p>
            </div>
          ) : null}
        </Panel>
      </div>

      {/* The thing a partner will assume, and be wrong about. */}
      <div className="mt-4">
        <Notice>
          <strong>Consent applies to your pixel too.</strong> We only fire it
          for visitors who have agreed to tracking, or who are somewhere that
          does not require consent. A visitor's refusal is not overridden
          because the pixel belongs to a partner — that would not be a
          defensible position for either of us.
        </Notice>
      </div>
    </>
  );
}
