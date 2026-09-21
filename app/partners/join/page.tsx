"use client";

// Partner application.
//
// One screen, four sections, no wizard. A wizard hides how much is left to do;
// a short honest form gets finished more often. Validation is inline and only
// fires once a field has been touched, so nobody is scolded while typing.

import Link from "next/link";
import { useState } from "react";
import {
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiClock,
  FiMail,
  FiUserPlus,
} from "react-icons/fi";
import { pPost, sha256Hex } from "../lib/api";

type Done = { code: string; message: string };

export default function PartnerJoin() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    website: "",
    audience: "",
    password: "",
    confirm: "",
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const t = (k: string) => touched[k];
  const mark = (k: string) => setTouched((s) => ({ ...s, [k]: true }));

  const errs = {
    name: form.name.trim().length < 2 ? "Enter your full name" : "",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())
      ? ""
      : "Enter a valid email address",
    phone:
      !form.phone || /^[6-9]\d{9}$/.test(form.phone)
        ? ""
        : "Enter a valid 10-digit mobile number",
    password: form.password.length < 8 ? "Use at least 8 characters" : "",
    confirm: form.confirm !== form.password ? "Passwords do not match" : "",
  };
  const valid = Object.values(errs).every((e) => !e);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    Object.keys(form).forEach(mark);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      // Only the hash leaves the browser. The raw password is never sent, never
      // logged, and never stored.
      const res = await pPost<Done>("/register", {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        company: form.company.trim(),
        website: form.website.trim(),
        audience: form.audience.trim(),
        password: await sha256Hex(form.password),
      });
      setDone(res);
    } catch (e: any) {
      setError(
        e?.message || "We could not submit your application. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Shell>
        <div className="mx-auto max-w-xl px-4 py-14">
          <div className="broker-card relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-brand/12 blur-3xl" />
            <div className="relative">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/12 text-brand">
                <FiClock size={22} />
              </span>
              <h1 className="mt-4 text-[24px] font-semibold tracking-tight text-foreground">
                Application received
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                {done.message} We review every partner by hand — it is how we
                keep the quality of traffic on the platform high.
              </p>

              <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Your referral code
                </div>
                <div className="display-num mt-1 text-[22px] font-semibold text-foreground">
                  {done.code}
                </div>
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Keep this. Links and campaign tags hang off it once you are
                  approved.
                </p>
              </div>

              <div className="mt-5 space-y-2.5">
                {[
                  "We review your application and set your commission rate.",
                  "You get access to the partner panel with links and landing pages.",
                  "Commission starts accruing from your first verified referral.",
                ].map((s) => (
                  <div key={s} className="flex gap-2.5">
                    <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand/12 text-[9px] font-bold text-brand">
                      ✓
                    </span>
                    <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                      {s}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/partners/login"
                  className="pressable btn-money inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[13px] font-semibold"
                >
                  Go to partner sign in
                  <FiArrowRight size={14} />
                </Link>
                <Link
                  href="/partners"
                  className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-[13px] font-semibold text-foreground"
                >
                  Back to programme
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="mx-auto max-w-[760px] px-4 py-10 lg:py-14">
        <Link
          href="/partners"
          className="pressable inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <FiArrowLeft size={13} />
          Partner programme
        </Link>

        <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-foreground sm:text-[32px]">
          Apply to become a partner
        </h1>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Two minutes, one form. We approve by hand and set your commission rate
          when we do — most applications are reviewed within a working day.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <Card title="About you" hint="So we know who we are working with">
            <div className="grid gap-3 sm:grid-cols-2">
              <F
                label="Full name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                onBlur={() => mark("name")}
                error={t("name") ? errs.name : ""}
                placeholder="Rohit Sharma"
              />
              <F
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                onBlur={() => mark("email")}
                error={t("email") ? errs.email : ""}
                placeholder="you@example.com"
              />
              <F
                label="Mobile"
                value={form.phone}
                onChange={(v) =>
                  setForm({ ...form, phone: v.replace(/\D/g, "").slice(0, 10) })
                }
                onBlur={() => mark("phone")}
                error={t("phone") ? errs.phone : ""}
                placeholder="10-digit number"
              />
              <F
                label="Company or brand (optional)"
                value={form.company}
                onChange={(v) => setForm({ ...form, company: v })}
                placeholder="Your channel or firm"
              />
            </div>
          </Card>

          <Card
            title="Your audience"
            hint="Helps us match you to the right landing pages"
          >
            <div className="grid gap-3">
              <F
                label="Main channel or website (optional)"
                value={form.website}
                onChange={(v) => setForm({ ...form, website: v })}
                placeholder="youtube.com/@yourchannel · @yourhandle · yoursite.com"
              />
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Who they are and how you reach them
                </span>
                <textarea
                  rows={3}
                  value={form.audience}
                  onChange={(e) =>
                    setForm({ ...form, audience: e.target.value })
                  }
                  maxLength={400}
                  placeholder="Mostly beginner retail traders in India, taught through short-form video and a Telegram group."
                  className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </label>
            </div>
          </Card>

          <Card
            title="Create your login"
            hint="You will use this to sign in once approved"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <F
                label="Password"
                type="password"
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                onBlur={() => mark("password")}
                error={t("password") ? errs.password : ""}
                placeholder="At least 8 characters"
              />
              <F
                label="Confirm password"
                type="password"
                value={form.confirm}
                onChange={(v) => setForm({ ...form, confirm: v })}
                onBlur={() => mark("confirm")}
                error={t("confirm") ? errs.confirm : ""}
              />
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <FiMail size={13} className="mt-0.5 shrink-0" />
              Your password is hashed in your browser before it is sent. We
              never see it, and we never store it in a readable form.
            </p>
          </Card>

          {error ? (
            <div className="rounded-xl border border-negative/30 bg-negative/8 px-3.5 py-3 text-[12.5px] text-negative">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="pressable btn-money inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[13.5px] font-semibold disabled:opacity-50"
            >
              <FiUserPlus size={15} />
              {busy ? "Submitting…" : "Submit application"}
            </button>
            <span className="text-[11.5px] text-muted-foreground">
              Already applied?{" "}
              <Link href="/partners/login" className="font-semibold text-brand">
                Sign in
              </Link>
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            By applying you agree that we may contact you about your
            application. Partner accounts are separate from trading accounts and
            are reviewed individually — approval is not automatic.
          </p>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur-xl">
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
            href="/partners/login"
            className="pressable inline-flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="broker-card p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-[13.5px] font-semibold text-foreground">{title}</h2>
        {hint ? (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function F({
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={type === "password" ? "new-password" : undefined}
        className={`mt-1 h-11 w-full rounded-xl border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 transition-colors focus:outline-none focus-visible:ring-2 ${
          error
            ? "border-negative/50 focus-visible:ring-negative/30"
            : "border-border focus-visible:ring-brand/40"
        }`}
      />
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-negative">
          {error}
        </span>
      ) : null}
    </label>
  );
}
