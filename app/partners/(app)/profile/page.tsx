"use client";

// Account — contact details, commercial terms (read-only), and security.
//
// The plan, the rates and the status are shown but not editable: those are an
// operator decision, and a self-service commission rate is not a feature.

import { useEffect, useState } from "react";
import { FiCheck, FiCopy, FiLock, FiLogOut, FiShield } from "react-icons/fi";
import { copyText, inr, pPost, sha256Hex, shortDate } from "../../lib/api";
import { usePartner } from "../../lib/store";
import { Badge } from "@/app/components/ui/kit";
import { CardSkeleton, Notice, PageHead, Panel, PanelHead } from "../../lib/ui";

export default function PartnerProfile() {
  const { me, loading, toast, reload } = usePartner();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    company: "",
    website: "",
    audience: "",
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setForm({
      name: me.affiliate.name,
      phone: me.affiliate.phone,
      company: me.affiliate.company,
      website: me.affiliate.website,
      audience: me.affiliate.audience,
    });
  }, [me]);

  if (!me && loading)
    return (
      <>
        <PageHead eyebrow="Account" title="Account details" />
        <CardSkeleton rows={4} />
      </>
    );

  const a = me!.affiliate;

  async function save() {
    setBusy(true);
    try {
      await pPost("/me", form);
      toast("Details saved", "ok");
      reload();
    } catch (e: any) {
      toast(e?.message || "Could not save your details", "err");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (pw.next.length < 8) return toast("Use at least 8 characters", "err");
    if (pw.next !== pw.confirm)
      return toast("The new passwords do not match", "err");
    setPwBusy(true);
    try {
      // The raw password never leaves the browser — only its sha256 does, which
      // is the same contract the sign-in form uses.
      await pPost("/password", {
        current: await sha256Hex(pw.current),
        next: await sha256Hex(pw.next),
      });
      setPw({ current: "", next: "", confirm: "" });
      toast("Password updated", "ok");
    } catch (e: any) {
      toast(e?.message || "Could not update your password", "err");
    } finally {
      setPwBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/partners/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    window.location.href = "/partners/login";
  }

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Account details"
        subtitle="Your contact details, your commercial terms, and your security."
        right={
          <Badge tone="positive">
            {a.planName} · {a.modelLabel}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Panel>
          <PanelHead
            title="Contact details"
            hint="Used for payout confirmations and account notices"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field
              label="Full name"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <Field
              label="Mobile"
              value={form.phone}
              onChange={(v) =>
                setForm({ ...form, phone: v.replace(/\D/g, "").slice(0, 10) })
              }
              placeholder="10-digit mobile"
            />
            <Field
              label="Company / brand"
              value={form.company}
              onChange={(v) => setForm({ ...form, company: v })}
            />
            <Field
              label="Website or main channel"
              value={form.website}
              onChange={(v) => setForm({ ...form, website: v })}
              placeholder="youtube.com/@yourchannel"
            />
            <label className="block sm:col-span-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Who your audience is
              </span>
              <textarea
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                rows={3}
                maxLength={400}
                placeholder="Traders, beginners, Hindi-speaking retail investors…"
                className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="pressable inline-flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-[12.5px] font-semibold text-background disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          {/* ── Identity ────────────────────────────────────────────────── */}
          <Panel>
            <PanelHead
              title="Partner identity"
              hint="Give this code to nobody but your link"
            />
            <div className="p-4">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Referral code
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="display-num text-[17px] font-semibold text-foreground">
                    {a.code}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyText(a.code);
                      setCopied(ok);
                      toast(
                        ok ? "Code copied" : "Could not copy",
                        ok ? "ok" : "err",
                      );
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="pressable grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                    aria-label="Copy referral code"
                  >
                    {copied ? (
                      <FiCheck size={13} className="text-positive" />
                    ) : (
                      <FiCopy size={13} />
                    )}
                  </button>
                </div>
              </div>
              <dl className="mt-3 space-y-2.5">
                <Info k="Email" v={a.email} />
                <Info k="Partner since" v={shortDate(a.createdAt)} />
                <Info
                  k="Status"
                  v={<span className="capitalize">{a.status}</span>}
                />
              </dl>
            </div>
          </Panel>

          {/* ── Terms ───────────────────────────────────────────────────── */}
          <Panel>
            <PanelHead
              title="Commercial terms"
              hint="Set by your account manager"
            />
            <div className="divide-y divide-border/60">
              <Info k="Plan" v={a.planName} />
              <Info k="Model" v={a.modelLabel} />
              {(a.model === "deposit" || a.model === "hybrid") && (
                <Info k="Deposit rate" v={`${a.depositRate}%`} />
              )}
              {(a.model === "revshare" || a.model === "hybrid") && (
                <Info k="Recurring share" v={`${a.revRate}%`} />
              )}
              <Info k="Holdback" v={`${a.holdDays} days`} />
              <Info k="Minimum payout" v={inr(a.minPayout)} />
            </div>
            <div className="p-4">
              <Notice>
                Need a better rate? Partners who consistently deliver funded
                customers are reviewed for an upgrade. Talk to your account
                manager with your numbers.
              </Notice>
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Security ────────────────────────────────────────────────────── */}
      <Panel className="mt-4">
        <PanelHead
          title="Security"
          hint="Change your password"
          right={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FiShield size={12} />
              scrypt-hashed
            </span>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field
            label="Current password"
            value={pw.current}
            onChange={(v) => setPw({ ...pw, current: v })}
            type="password"
          />
          <Field
            label="New password"
            value={pw.next}
            onChange={(v) => setPw({ ...pw, next: v })}
            type="password"
            placeholder="At least 8 characters"
          />
          <Field
            label="Confirm new password"
            value={pw.confirm}
            onChange={(v) => setPw({ ...pw, confirm: v })}
            type="password"
          />
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={changePassword}
              disabled={pwBusy}
              className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-[12.5px] font-semibold text-foreground disabled:opacity-50"
            >
              <FiLock size={14} />
              {pwBusy ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="pressable inline-flex h-11 items-center gap-2 rounded-xl border border-negative/30 px-5 text-[12.5px] font-semibold text-negative"
            >
              <FiLogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
        placeholder={placeholder}
        autoComplete={type === "password" ? "off" : undefined}
        className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      />
    </label>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-[11.5px] text-muted-foreground">{k}</dt>
      <dd className="display-num truncate text-[12.5px] font-medium text-foreground">
        {v}
      </dd>
    </div>
  );
}
