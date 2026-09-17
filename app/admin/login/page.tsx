"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck } from "react-icons/fi";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, otp }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.otpRequired) setNeedOtp(true);
        setErr(j.error || "Login failed");
        return;
      }
      router.push("/admin");
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[880px] overflow-hidden rounded-xl border border-border bg-card sm:grid sm:grid-cols-2">
        <div className="hidden flex-col justify-between border-r border-border bg-muted/40 p-8 sm:flex">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg font-black text-brand-foreground">
                T
              </div>
              <div>
                <div className="text-[15px] font-bold text-foreground">
                  TradeKaro
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  OPERATIONS CONSOLE
                </div>
              </div>
            </div>
            <ul className="mt-8 flex flex-col gap-3 text-[13px] text-muted-foreground">
              <li className="flex gap-2">
                <FiCheck
                  size={15}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-positive"
                />
                Live client directory with PAN &amp; KYC
              </li>
              <li className="flex gap-2">
                <FiCheck
                  size={15}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-positive"
                />
                Kill-switches for provider, fills &amp; maintenance
              </li>
              <li className="flex gap-2">
                <FiCheck
                  size={15}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-positive"
                />
                Full audit trail of every admin action
              </li>
            </ul>
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            Restricted access · 5 wrong tries = 15 min lock · all logins audited
          </div>
        </div>
        <form onSubmit={submit} className="p-6 sm:p-8">
          <div className="text-xl font-semibold tracking-tight text-foreground">
            Admin sign in
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            Use your console credential to continue.
          </div>
          {/* Credentials are only echoed back while developing. Printing a
              working admin login on a public page hands the console away. */}
          {process.env.NODE_ENV !== "production" ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
              Dev only:{" "}
              <span className="font-mono font-semibold text-foreground">
                the bootstrap admin created on first boot
              </span>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
              Work email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                autoComplete="username"
                className="min-h-[44px] rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
                className="min-h-[44px] rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            {needOtp ? (
              <label className="flex flex-col gap-1.5 text-[11px] font-medium text-muted-foreground">
                6-digit OTP
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  className="min-h-[44px] rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </label>
            ) : null}
          </div>
          {err ? (
            <div className="mt-3 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-[12px] font-semibold text-negative">
              {err}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="pressable mt-4 min-h-[46px] w-full rounded-md bg-foreground text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Sign in →"}
          </button>
          <div className="mt-3 text-center text-[11px] text-muted-foreground/70">
            Separate console credential · never your trading password
          </div>
        </form>
      </div>
    </div>
  );
}
