"use client";

// Partner sign-in.
//
// Uses a direct fetch rather than the shared helper: a wrong password answers
// 401, and the helper treats 401 as "session expired" and redirects — which on
// this page would be a redirect to itself, wiping the error message.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  FiAlertCircle,
  FiArrowLeft,
  FiCheckCircle,
  FiClock,
  FiLock,
  FiLogIn,
  FiMail,
} from "react-icons/fi";
import { sha256Hex } from "../lib/api";

type Blocked = { kind: "pending" | "rejected" | "suspended"; message: string };

export default function PartnerLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <PartnerLogin />
    </Suspense>
  );
}

function PartnerLogin() {
  const params = useSearchParams();
  const next = params.get("next") || "/partners/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [checking, setChecking] = useState(true);

  /**
   * If a partner is already signed in, go straight to the panel.
   *
   * This has to happen HERE and not in the edge proxy. The proxy can only test
   * the cookie's signature, and a signature stays valid after the affiliate has
   * been suspended or deleted — so a proxy-side redirect sent those partners to
   * a dashboard that immediately bounced them back, forever. This call reaches
   * the API, which reads the database and answers honestly.
   *
   * `fetch` is used directly rather than the shared helper: the helper treats a
   * 401 as "session expired" and redirects, which from this page would be a
   * redirect to itself.
   */
  useEffect(() => {
    let live = true;
    fetch("/api/partners/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          window.location.replace(
            next.startsWith("/partners") ? next : "/partners/dashboard",
          );
          return;
        }
        setChecking(false);
      })
      .catch(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password");
      return;
    }
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const res = await fetch("/api/partners/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: await sha256Hex(password),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // Full navigation, not router.push: the proxy makes the final decision
        // on /partners/* and it needs to see the new cookie on a fresh request.
        window.location.href = next.startsWith("/partners")
          ? next
          : "/partners/dashboard";
        return;
      }

      if (res.status === 403 && data?.status) {
        setBlocked({
          kind: data.status,
          message: String(data.error || "Your account is not active."),
        });
        return;
      }
      setError(String(data?.error || "Could not sign you in."));
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="pointer-events-none fixed -right-24 -top-32 h-[380px] w-[380px] rounded-full bg-brand/8 blur-3xl" />

      <header className="relative border-b border-border bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <Link href="/partners" className="flex items-center gap-2.5">
            <span className="brand-panel grid h-8 w-8 place-items-center rounded-xl text-[13px] font-black text-brand-foreground">
              TS
            </span>
            <span className="leading-none">
              <span className="block text-[13.5px] font-semibold tracking-tight text-foreground">
                TradeStox
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                Partners
              </span>
            </span>
          </Link>
          <Link
            href="/partners/join"
            className="pressable inline-flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground"
          >
            Apply
          </Link>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-[1000px] gap-8 px-4 py-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:py-16">
        <div className="hidden lg:block">
          <div className="eyebrow">Partner panel</div>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-tight text-foreground">
            Your traffic. Your numbers. Your money.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
            Sign in to see live clicks, signups and commission, grab a landing
            page link, and request a payout to UPI or USDT.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              "Live dashboard — no waiting for a monthly report",
              "Server-side attribution that survives cleared cookies",
              "Payouts to UPI, bank or USDT on request",
            ].map((s) => (
              <li key={s} className="flex gap-2.5">
                <FiCheckCircle
                  size={15}
                  className="mt-0.5 shrink-0 text-brand"
                />
                <span className="text-[13px] leading-relaxed text-muted-foreground">
                  {s}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="broker-card p-5 sm:p-6">
          <Link
            href="/partners"
            className="pressable inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground lg:hidden"
          >
            <FiArrowLeft size={12} />
            Partner programme
          </Link>

          <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-foreground lg:mt-0">
            Sign in
          </h2>
          {/* While the API is asked whether this browser already has a live
              partner session, a quiet bar beats a form that fills in and then
              vanishes from under the user. */}
          {checking ? (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="brand-gradient h-full w-1/3 animate-pulse rounded-full" />
            </div>
          ) : null}
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Partner accounts are separate from trading accounts.
          </p>

          {blocked ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/8 p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
                  {blocked.kind === "pending" ? (
                    <FiClock size={16} />
                  ) : (
                    <FiAlertCircle size={16} />
                  )}
                </span>
                <div>
                  <div className="text-[12.5px] font-semibold capitalize text-amber-700 dark:text-amber-300">
                    {blocked.kind === "pending"
                      ? "Application under review"
                      : blocked.kind === "suspended"
                        ? "Account suspended"
                        : "Application not approved"}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                    {blocked.message}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Email
              </span>
              <div className="relative mt-1">
                <FiMail
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Password
              </span>
              <div className="relative mt-1">
                <FiLock
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </div>
            </label>

            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/8 px-3 py-2.5 text-[12px] text-negative">
                <FiAlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="pressable btn-money inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold disabled:opacity-50"
            >
              <FiLogIn size={15} />
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-4 border-t border-border/60 pt-3.5 text-[11.5px] text-muted-foreground">
            Not a partner yet?{" "}
            <Link href="/partners/join" className="font-semibold text-brand">
              Apply in two minutes
            </Link>
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
            Looking for your trading account instead?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground/80 hover:text-foreground"
            >
              Sign in to the trading app
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
