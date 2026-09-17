"use client";
import { useCallback, useEffect, useState } from "react";
import {
  AccountHeader,
  Badge,
  Dot,
  Row,
  Section,
  btnGhost,
  btnPrimary,
} from "@/app/components/ui/kit";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import {
  FiCheck,
  FiCopy,
  FiExternalLink,
  FiKey,
  FiLock,
  FiShield,
  FiUser,
} from "react-icons/fi";
import { sileo } from "sileo";

// Connect a trading account to an external platform (trader / algo bridge).
//
// The page pairs the User ID with a connection token. Whether the token can be
// revealed is decided server-side in /api/account/connect — KYC must be signed
// off first — so this screen only ever renders that verdict.

type Standing = {
  userId: string;
  clientID: string;
  /** Broker-style display ID (TK267X9Q4) — what the user should recognise. */
  clientCode?: string;
  username: string;
  email: string;
  kyc: string;
  status: "ACTIVE" | "FROZEN";
  unlocked: boolean;
  gate: {
    required: number;
    deposited: number;
    remaining: number;
    eligible: boolean;
    open: boolean;
    progress: number;
  };
};

const MASK = "•••••-•••••-•••••";

function maskEmail(email: string) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return email || "—";
  const head = name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function money(n: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

export default function ConnectPage() {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState("");
  const [copied, setCopied] = useState<"" | "id" | "token">("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/account/connect", { cache: "no-store" });
        if (cancelled) return;
        if (r.status === 401) {
          setSignedOut(true);
          return;
        }
        setStanding(await r.json());
      } catch {
        /* the sign-in prompt below covers an unreachable server too */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = useCallback(async (value: string, which: "id" | "token") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      sileo.error({ title: "Could not copy — select and copy manually" });
    }
  }, []);

  async function reveal() {
    setBusy(true);
    setBlocked("");
    try {
      const r = await fetch("/api/account/connect", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The server decides: this is the "complete KYC" answer arriving.
        setBlocked(String(j?.error || "Token is not available"));
        return;
      }
      setToken(String(j?.token || ""));
    } catch {
      setBlocked("Network error — could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  const kycDone = standing?.kyc === "VERIFIED";
  const frozen = standing?.status === "FROZEN";
  const ready = Boolean(standing?.unlocked);
  // The broker-style code is what the customer recognises. Older sessions have
  // no code yet, so fall back to the raw id rather than showing a blank.
  const clientCode = standing?.clientCode || "";

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 md:pb-16">
      <div className="mx-auto max-w-3xl">
        <AccountHeader
          title="Connect account"
          description="Link this trading account to an external platform using your User ID and a connection token."
          badge={
            loading ? null : (
              <Badge tone={ready ? "positive" : "neutral"}>
                {ready ? <Dot /> : <FiLock size={11} aria-hidden />}
                {frozen
                  ? "Frozen"
                  : ready
                    ? "Ready to connect"
                    : "Not connected"}
              </Badge>
            )
          }
        />

        {signedOut ? (
          <section className="broker-card mx-auto mt-8 max-w-sm p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-foreground/70">
              <FiKey size={20} aria-hidden />
            </span>
            <h2 className="mt-3 text-base font-semibold">
              Sign in to connect an account
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Your User ID and connection token are tied to your login.
            </p>
            <NavTransition
              href="/login"
              className="pressable mt-4 flex h-11 items-center justify-center rounded-lg bg-foreground text-[12px] font-semibold text-background"
            >
              SIGN IN
            </NavTransition>
          </section>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Identity — the half of the credential pair the user can always see */}
            <Section
              title="Your credentials"
              description="Share these with the platform you are connecting. They identify the account, they do not authorise trades on their own."
            >
              <Row
                icon={<FiUser size={17} aria-hidden />}
                label={
                  <span className="font-mono tracking-wide">
                    {loading ? "—" : clientCode || standing?.clientID || "—"}
                  </span>
                }
                sub="User ID — paste this first"
                badge={
                  loading ? null : (
                    <button
                      onClick={() =>
                        standing && copy(clientCode || standing.clientID, "id")
                      }
                      aria-label="Copy user ID"
                      className="pressable shrink-0 rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copied === "id" ? (
                        <FiCheck
                          size={14}
                          aria-hidden
                          className="text-positive"
                        />
                      ) : (
                        <FiCopy size={14} aria-hidden />
                      )}
                    </button>
                  )
                }
              />
              <Row
                icon={<FiShield size={17} aria-hidden />}
                label={loading ? "—" : maskEmail(standing?.email || "")}
                sub="Registered email — the platform matches it on first link"
              />
              <Row
                label="Account standing"
                sub={
                  frozen
                    ? "Frozen — connecting a new platform is blocked"
                    : "Active — ready to link"
                }
                badge={
                  loading ? null : (
                    <Badge tone={frozen ? "negative" : "positive"}>
                      <Dot />
                      {frozen ? "Frozen" : "Active"}
                    </Badge>
                  )
                }
              />
              <Row
                label="KYC status"
                sub={
                  kycDone
                    ? "Verified — your token is available"
                    : "The connection token unlocks once KYC is verified"
                }
                badge={
                  loading ? null : (
                    <Badge tone={kycDone ? "positive" : "neutral"}>
                      <Dot />
                      {standing?.kyc === "UNKNOWN"
                        ? "Not started"
                        : standing?.kyc || "—"}
                    </Badge>
                  )
                }
              />
            </Section>

            {/* The token — the thing the whole page exists for */}
            <Section
              title="Connection token"
              description="Acts as the account's password for the platform you connect. Keep it private."
            >
              <div className="p-4 sm:p-5">
                <div
                  className={`flex min-h-[64px] items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-3 sm:px-4 ${
                    token
                      ? "border-brand/40 bg-brand/[0.06]"
                      : "border-border bg-muted/40"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FiKey
                      size={15}
                      aria-hidden
                      className={
                        token
                          ? "shrink-0 text-brand"
                          : "shrink-0 text-muted-foreground/60"
                      }
                    />
                    <span
                      className={`min-w-0 break-all font-mono text-[13px] tabular-nums tracking-[0.14em] sm:text-[15px] sm:tracking-[0.18em] ${
                        token ? "text-foreground" : "text-muted-foreground/70"
                      }`}
                    >
                      {loading ? (
                        <span className="skeleton inline-block h-4 w-40 align-middle" />
                      ) : token ? (
                        token
                      ) : (
                        MASK
                      )}
                    </span>
                  </span>
                  {token ? (
                    <button
                      onClick={() => copy(token, "token")}
                      aria-label="Copy connection token"
                      className="pressable shrink-0 rounded-md border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copied === "token" ? (
                        <FiCheck
                          size={14}
                          aria-hidden
                          className="text-positive"
                        />
                      ) : (
                        <FiCopy size={14} aria-hidden />
                      )}
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[11.5px] text-muted-foreground">
                    {loading
                      ? "Checking your account…"
                      : token
                        ? "Revealed — copy it now"
                        : kycDone
                          ? "Verified — you can reveal your token"
                          : "Locked until KYC is verified"}
                  </span>
                  <div className="flex gap-2">
                    {token ? (
                      <>
                        <button
                          onClick={() => setToken("")}
                          className={`${btnGhost} flex-1 sm:flex-none`}
                        >
                          HIDE
                        </button>
                        <button
                          onClick={() => copy(token, "token")}
                          className={`${btnPrimary} flex-1 sm:flex-none`}
                        >
                          {copied === "token" ? "COPIED" : "COPY TOKEN"}
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={loading || busy}
                        onClick={reveal}
                        className={`${btnPrimary} flex-1 sm:flex-none`}
                      >
                        {busy ? "CHECKING…" : "REVEAL TOKEN"}
                      </button>
                    )}
                  </div>
                </div>

                {/* The refusal the server sends back — the point of the button */}
                {blocked ? (
                  <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
                    <div className="flex items-start gap-2">
                      <FiLock
                        size={14}
                        aria-hidden
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-foreground">
                          {blocked}
                        </div>
                        {!kycDone ? (
                          <>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                              {standing &&
                              !standing.gate.open &&
                              !standing.gate.eligible
                                ? `Your KYC also needs ${money(
                                    standing.gate.required,
                                  )} of deposits — ${money(
                                    standing.gate.deposited,
                                  )} received, ${money(
                                    standing.gate.remaining,
                                  )} to go.`
                                : "Finish the KYC steps and an operator will verify them before the token is issued."}
                            </p>
                            <NavTransition
                              href="/profile/kyc"
                              className={`${btnPrimary} mt-2.5 px-4`}
                            >
                              GO TO KYC
                            </NavTransition>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </Section>

            {/* Instructions — what a real integration page always carries */}
            <Section
              title="How to connect"
              description="Three steps, once per platform."
            >
              {[
                {
                  n: "1",
                  t: "Copy your User ID",
                  d: "It is shown at the top of this page. The platform uses it to identify the account.",
                },
                {
                  n: "2",
                  t: "Reveal and copy the token",
                  d: "Unlocks after KYC. Treat it like a password — anyone holding it can link this account.",
                },
                {
                  n: "3",
                  t: "Paste both into the platform",
                  d: "Open its “Connect account” screen, paste the User ID and the token, then confirm.",
                },
              ].map((s) => (
                <div key={s.n} className="flex items-start gap-3 p-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 font-mono text-[12px] font-semibold text-foreground/70">
                    {s.n}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">
                      {s.t}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                      {s.d}
                    </span>
                  </span>
                </div>
              ))}
            </Section>

            <Section
              title="Connected platforms"
              description="Every platform currently holding a valid token for this account."
            >
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-foreground/70">
                    <FiExternalLink size={16} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-medium">
                      No platforms connected
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {ready
                        ? "Reveal your token to link your first one."
                        : "Available once KYC is verified."}
                    </span>
                  </span>
                </div>
                {!ready && !loading ? (
                  <NavTransition
                    href="/profile/kyc"
                    className={`${btnGhost} w-full sm:w-auto`}
                  >
                    COMPLETE KYC
                  </NavTransition>
                ) : null}
              </div>
            </Section>

            <Section title="Security">
              <div className="flex items-start gap-3 p-4">
                <FiShield
                  size={15}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <span className="text-[12px] leading-relaxed text-muted-foreground">
                  The token is issued by the server and shown only to a
                  signed-in, KYC-verified account. Never paste it into a chat, a
                  screenshot or an email — if you think it has leaked, ask
                  support to rotate it.
                </span>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
