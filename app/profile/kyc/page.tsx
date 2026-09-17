"use client";
import { useEffect, useState } from "react";
import {
  AccountHeader,
  Badge,
  Dot,
  Field,
  Row,
  Section,
  btnPrimary,
  inputClass,
  textareaClass,
} from "@/app/components/ui/kit";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import { FiCheck, FiCircle, FiLock, FiShield } from "react-icons/fi";
import { useKycGate } from "@/app/lib/trading";
import { money } from "@/app/lib/format";
import { sileo } from "sileo";

const DRAFT_KEY = "fs_kyc_draft";

type Draft = {
  pan: string;
  dob: string;
  address: string;
  nominee: string;
  signature: boolean;
  incomeSlab: string;
};

const STEPS = [
  { id: "pan", label: "PAN details", desc: "PAN number + date of birth" },
  {
    id: "address",
    label: "Address proof",
    desc: "Aadhaar / passport / utility bill",
  },
  { id: "bank", label: "Bank proof", desc: "Cancelled cheque or statement" },
  {
    id: "income",
    label: "Income slab",
    desc: "Required for derivatives segment",
  },
  { id: "nominee", label: "Nominee", desc: "Optional but recommended" },
  { id: "sign", label: "E-sign", desc: "Aadhaar OTP or DigiLocker" },
];

export default function KycPage() {
  const [draft, setDraft] = useState<Draft>({
    pan: "",
    dob: "",
    address: "",
    nominee: "",
    signature: false,
    incomeSlab: "",
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setDraft({ ...draft, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(partial: Partial<Draft>) {
    const next = { ...draft, ...partial };
    setDraft(next);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function doneCount() {
    let n = 0;
    if (draft.pan.trim().length >= 10) n += 2; // pan + dob-ish
    if (draft.address.trim()) n += 1;
    if (draft.incomeSlab) n += 1;
    if (draft.nominee.trim()) n += 1;
    if (draft.signature) n += 1;
    return Math.min(n, STEPS.length);
  }
  const done = doneCount();

  // Deposits are the entry ticket: KYC is only open to users who have funded
  // the account up to the amount the admin set. The figure and the verdict are
  // computed server-side (see tradingServer.publicAccount), so nothing here can
  // be unlocked by editing the browser.
  //
  // The form itself is not rendered until the requirement is met — a disabled
  // form implies "fill this in later", which is not what the rule means.
  const gate = useKycGate();
  const locked = !gate.eligible;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 md:pb-16">
      <div className="mx-auto max-w-3xl">
        <AccountHeader
          title="KYC verification"
          description="Complete these steps once to unlock the full derivatives and payout experience."
          badge={
            locked ? (
              <Badge tone="neutral">
                <FiLock size={11} aria-hidden />
                Locked
              </Badge>
            ) : (
              <Badge tone={done === STEPS.length ? "positive" : "neutral"}>
                <Dot />
                {done}/{STEPS.length} completed
              </Badge>
            )
          }
        />

        <div className="mt-6 space-y-6">
          {/* The deposit requirement comes first — it is the reason the form
              below is locked, and the only thing the user has to act on. */}
          {!gate.open ? (
            <Section
              title="Eligibility"
              description={`KYC is available to users who have funded ${money(
                gate.required,
              )} or more.`}
            >
              <div className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-muted-foreground">
                    {gate.loaded ? (
                      <>
                        <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                          {money(gate.deposited)}
                        </span>{" "}
                        deposited
                        {!gate.eligible ? (
                          <>
                            {" \u00b7 "}
                            <span className="font-mono font-semibold tabular-nums text-foreground">
                              {money(gate.remaining)}
                            </span>{" "}
                            left
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="skeleton inline-block h-5 w-44 align-middle" />
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    of {money(gate.required)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all ${gate.eligible ? "bg-positive" : "brand-gradient"}`}
                    style={{ width: `${gate.progress * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  {!gate.loaded ? (
                    <>Checking your deposit progress…</>
                  ) : gate.eligible ? (
                    <>You meet the requirement — you can complete KYC now.</>
                  ) : (
                    <>
                      Add {""}
                      <span className="font-semibold text-foreground">
                        {money(gate.remaining)}
                      </span>{" "}
                      more to your account to unlock KYC. Deposits also raise
                      your trading capital, so the money is available to trade
                      straight away.
                    </>
                  )}
                </p>
              </div>
            </Section>
          ) : null}

          {locked ? (
            <Section
              title="Locked until you qualify"
              description="The application form opens as soon as your deposits reach the requirement."
            >
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <span className="text-[12px] text-muted-foreground">
                  {gate.loaded ? (
                    <>
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        {money(gate.remaining)}
                      </span>{" "}
                      still to deposit
                    </>
                  ) : (
                    // Before the first account fetch we know the requirement but
                    // not their deposits — say nothing rather than the wrong thing.
                    <span className="skeleton inline-block h-4 w-32 align-middle" />
                  )}
                </span>
                <NavTransition
                  href="/portfolio"
                  className={`${btnPrimary} px-5`}
                >
                  ADD FUNDS
                </NavTransition>
              </div>
            </Section>
          ) : (
            <>
              <Section
                title="Progress"
                description="Drafts are stored on this device until you e-sign."
              >
                <div className="p-5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full brand-gradient transition-all"
                      style={{ width: `${(done / STEPS.length) * 100}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {STEPS.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-3 py-2">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${i < done ? "border-positive/40 bg-positive/10 text-positive" : "border-border bg-muted/50 text-muted-foreground"}`}
                        >
                          {i < done ? (
                            <FiCheck size={13} aria-hidden />
                          ) : (
                            <FiCircle size={11} aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">
                            {s.label}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {s.desc}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>

              <Section
                title="PAN & personal"
                description="Must match your PAN card exactly."
              >
                <div className="space-y-3 p-5">
                  <Field label="PAN" hint="10 characters, e.g. ABCDE1234F">
                    <input
                      value={draft.pan}
                      onChange={(e) =>
                        save({ pan: e.target.value.toUpperCase() })
                      }
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      className={`${inputClass} font-mono uppercase tracking-wide`}
                    />
                  </Field>
                  <Field label="Date of birth">
                    <input
                      type="date"
                      value={draft.dob}
                      onChange={(e) => save({ dob: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Address">
                    <textarea
                      value={draft.address}
                      onChange={(e) => save({ address: e.target.value })}
                      rows={3}
                      placeholder="Full address as per proof"
                      className={textareaClass}
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Trading & nominee"
                description="Income slab is required for the derivatives segment."
              >
                <div className="space-y-3 p-5">
                  <Field label="Annual income slab">
                    <select
                      value={draft.incomeSlab}
                      onChange={(e) => save({ incomeSlab: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Select…</option>
                      <option value="<1L">Below ₹1L</option>
                      <option value="1-5L">₹1L – ₹5L</option>
                      <option value="5-10L">₹5L – ₹10L</option>
                      <option value="10-25L">₹10L – ₹25L</option>
                      <option value="25L+">Above ₹25L</option>
                    </select>
                  </Field>
                  <Field label="Nominee" hint="Optional but recommended">
                    <input
                      value={draft.nominee}
                      onChange={(e) => save({ nominee: e.target.value })}
                      placeholder="Nominee full name"
                      className={inputClass}
                    />
                  </Field>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={draft.signature}
                      onChange={(e) => save({ signature: e.target.checked })}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
                    />
                    <span className="text-[12px] leading-snug text-muted-foreground">
                      I confirm the details above are correct and ready to
                      e-sign.
                    </span>
                  </label>
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() =>
                        sileo.success({
                          title: "KYC draft saved on this device",
                        })
                      }
                      className={`${btnPrimary} px-5`}
                    >
                      SAVE DRAFT
                    </button>
                  </div>
                </div>
              </Section>

              <Section title="What happens next">
                <Row
                  icon={<FiShield size={17} aria-hidden />}
                  label="Verification usually completes in 24–48 hours"
                  sub="You'll get a notification once the KYC is approved"
                />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
