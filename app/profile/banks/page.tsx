"use client";
import { useEffect, useState } from "react";
import {
  AccountHeader,
  Badge,
  Field,
  Row,
  Section,
  btnDanger,
  btnGhost,
  btnPrimary,
  inputClass,
} from "@/app/components/ui/kit";
import { FiCreditCard, FiPlus, FiSmartphone, FiX } from "react-icons/fi";
import { sileo } from "sileo";

export type BankAccount = {
  id: string;
  label: string;
  holder: string;
  bank: string;
  accountNo: string;
  ifsc: string;
  primary: boolean;
  verified: boolean;
  addedAt: number;
};

export type UpiId = {
  id: string;
  vpa: string;
  primary: boolean;
  addedAt: number;
};

const BANK_KEY = "fs_bank_accounts";
const UPI_KEY = "fs_upi_ids";

export function getBanks(): BankAccount[] {
  try {
    return JSON.parse(localStorage.getItem(BANK_KEY) || "[]");
  } catch {
    return [];
  }
}

export function getUpis(): UpiId[] {
  try {
    return JSON.parse(localStorage.getItem(UPI_KEY) || "[]");
  } catch {
    return [];
  }
}

function maskAcct(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length <= 4) return "••••";
  return `•••• •••• ${d.slice(-4)}`;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

export default function BanksPage() {
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [upis, setUpis] = useState<UpiId[]>([]);
  const [showBank, setShowBank] = useState(false);
  const [showUpi, setShowUpi] = useState(false);
  const [form, setForm] = useState({
    label: "",
    holder: "",
    bank: "",
    accountNo: "",
    ifsc: "",
  });
  const [upi, setUpi] = useState("");

  useEffect(() => {
    try {
      setBanks(getBanks());
      setUpis(getUpis());
    } catch {
      /* ignore */
    }
  }, []);

  function persistBanks(next: BankAccount[]) {
    setBanks(next);
    try {
      localStorage.setItem(BANK_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function persistUpis(next: UpiId[]) {
    setUpis(next);
    try {
      localStorage.setItem(UPI_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function addBank(e: React.FormEvent) {
    e.preventDefault();
    const accountNo = form.accountNo.replace(/\s/g, "");
    const ifsc = form.ifsc.trim().toUpperCase();
    if (!form.holder.trim() || !form.bank.trim()) {
      sileo.error({ title: "Holder + bank name required" });
      return;
    }
    if (!/^\d{9,18}$/.test(accountNo)) {
      sileo.error({ title: "Account number must be 9–18 digits" });
      return;
    }
    if (!IFSC_RE.test(ifsc)) {
      sileo.error({ title: "IFSC looks wrong (e.g. HDFC0001234)" });
      return;
    }
    const entry: BankAccount = {
      id: Math.random().toString(36).slice(2),
      label: form.label.trim() || form.bank.trim(),
      holder: form.holder.trim(),
      bank: form.bank.trim(),
      accountNo,
      ifsc,
      primary: banks.length === 0,
      verified: false,
      addedAt: Date.now(),
    };
    persistBanks([...banks, entry]);
    setForm({ label: "", holder: "", bank: "", accountNo: "", ifsc: "" });
    setShowBank(false);
    sileo.success({ title: "Bank account saved" });
  }

  function addUpi(e: React.FormEvent) {
    e.preventDefault();
    const vpa = upi.trim();
    if (!UPI_RE.test(vpa)) {
      sileo.error({ title: "Enter a valid UPI id (name@bank)" });
      return;
    }
    if (upis.some((u) => u.vpa.toLowerCase() === vpa.toLowerCase())) {
      sileo.error({ title: "That UPI id is already added" });
      return;
    }
    persistUpis([
      ...upis,
      {
        id: Math.random().toString(36).slice(2),
        vpa,
        primary: upis.length === 0,
        addedAt: Date.now(),
      },
    ]);
    setUpi("");
    setShowUpi(false);
    sileo.success({ title: "UPI id saved" });
  }

  const bankFields = [
    { k: "label", label: "Label", ph: "HDFC Salary" },
    { k: "holder", label: "Account holder", ph: "Full name as per bank" },
    { k: "bank", label: "Bank name", ph: "HDFC Bank" },
    { k: "accountNo", label: "Account number", ph: "9–18 digits" },
    { k: "ifsc", label: "IFSC", ph: "HDFC0001234" },
  ] as const;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 md:pb-16">
      <div className="mx-auto max-w-3xl">
        <AccountHeader
          title="Banks & UPI"
          description="Payout accounts used for withdrawals and settlements."
          actions={
            <>
              <button
                onClick={() => setShowBank((v) => !v)}
                className={showBank ? btnGhost : btnPrimary}
              >
                {showBank ? (
                  <>
                    <FiX size={14} aria-hidden /> CLOSE
                  </>
                ) : (
                  <>
                    <FiPlus size={14} aria-hidden /> BANK
                  </>
                )}
              </button>
              <button
                onClick={() => setShowUpi((v) => !v)}
                className={btnGhost}
              >
                {showUpi ? (
                  <>
                    <FiX size={14} aria-hidden /> CLOSE
                  </>
                ) : (
                  <>
                    <FiPlus size={14} aria-hidden /> UPI
                  </>
                )}
              </button>
            </>
          }
        />

        <div className="mt-6 space-y-6">
          {showBank && (
            <Section
              title="Add bank account"
              description="We verify the account before the first payout."
            >
              <form onSubmit={addBank} className="p-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {bankFields.map((f) => (
                    <Field key={f.k} label={f.label}>
                      <input
                        value={(form as any)[f.k]}
                        onChange={(e) =>
                          setForm({ ...form, [f.k]: e.target.value })
                        }
                        placeholder={f.ph}
                        inputMode={f.k === "accountNo" ? "numeric" : undefined}
                        className={inputClass}
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="submit" className={`${btnPrimary} px-5`}>
                    SAVE ACCOUNT
                  </button>
                </div>
              </form>
            </Section>
          )}

          {showUpi && (
            <Section
              title="Add UPI id"
              description="Receive payouts to a virtual payment address."
            >
              <form
                onSubmit={addUpi}
                className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <Field label="UPI id">
                    <input
                      value={upi}
                      onChange={(e) => setUpi(e.target.value)}
                      placeholder="name@okhdfc"
                      inputMode="email"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <button type="submit" className={`${btnPrimary} shrink-0`}>
                  SAVE UPI
                </button>
              </form>
            </Section>
          )}

          <Section
            title="Bank accounts"
            description="The primary account receives all withdrawals."
          >
            {banks.length === 0 ? (
              <Row
                icon={<FiCreditCard size={17} aria-hidden />}
                label="No bank accounts yet"
                sub="Add one to enable withdrawals from your trading account"
              />
            ) : (
              banks.map((b) => (
                <div key={b.id} className="flex items-start gap-3 px-4 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-foreground/70">
                    <FiCreditCard size={17} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium">
                        {b.label}
                      </span>
                      {b.primary ? <Badge tone="brand">Primary</Badge> : null}
                      <Badge tone={b.verified ? "positive" : "neutral"}>
                        {b.verified ? "Verified" : "Unverified"}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {b.bank} · {maskAcct(b.accountNo)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {b.holder} · {b.ifsc}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!b.primary && (
                        <button
                          onClick={() =>
                            persistBanks(
                              banks.map((x) => ({
                                ...x,
                                primary: x.id === b.id,
                              })),
                            )
                          }
                          className="pressable h-8 rounded-md border border-border px-3 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-muted/50"
                        >
                          SET PRIMARY
                        </button>
                      )}
                      <button
                        onClick={() =>
                          persistBanks(banks.filter((x) => x.id !== b.id))
                        }
                        className="pressable h-8 rounded-md border border-negative/40 px-3 text-[11px] font-semibold text-negative transition-colors hover:bg-negative/10"
                      >
                        REMOVE
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </Section>

          <Section
            title={`UPI ids${upis.length ? ` · ${upis.length}` : ""}`}
            description="Secondary payout routes for instant transfers."
          >
            {upis.length === 0 ? (
              <Row
                icon={<FiSmartphone size={17} aria-hidden />}
                label="No UPI ids saved"
                sub="Add one to receive instant payouts"
              />
            ) : (
              upis.map((u) => (
                <div key={u.id} className="flex items-start gap-3 px-4 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-foreground/70">
                    <FiSmartphone size={17} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-[13.5px] font-medium">
                        {u.vpa}
                      </span>
                      {u.primary ? <Badge tone="brand">Primary</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {u.primary
                        ? "Primary payout route"
                        : "Secondary payout route"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!u.primary && (
                        <button
                          onClick={() =>
                            persistUpis(
                              upis.map((x) => ({
                                ...x,
                                primary: x.id === u.id,
                              })),
                            )
                          }
                          className="pressable h-8 rounded-md border border-border px-3 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-muted/50"
                        >
                          SET PRIMARY
                        </button>
                      )}
                      <button
                        onClick={() =>
                          persistUpis(upis.filter((x) => x.id !== u.id))
                        }
                        className="pressable h-8 rounded-md border border-negative/40 px-3 text-[11px] font-semibold text-negative transition-colors hover:bg-negative/10"
                      >
                        REMOVE
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
