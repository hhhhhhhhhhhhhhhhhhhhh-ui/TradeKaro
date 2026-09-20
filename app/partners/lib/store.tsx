"use client";

// One fetch of `/api/partners/me` shared by the whole panel.
//
// The shell needs the partner's name and code, and the dashboard needs the same
// payload. Fetching it twice on the home screen is the kind of duplication that
// makes a panel feel slow on a phone, so it lives in context and every page
// reads it from there.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { pGet } from "./api";

export type Partner = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  audience: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  planName: string;
  model: "deposit" | "revshare" | "hybrid";
  modelLabel: string;
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
  createdAt: number;
  rejectReason: string;
};

export type Summary = {
  clicks: number;
  signups: number;
  conversion: number;
  customers: number;
  deposited: number;
  earned: number;
  pending: number;
  available: number;
  paid: number;
  reversed: number;
};

export type Point = {
  date: string;
  clicks: number;
  signups: number;
  earned: number;
};

export type Commission = {
  id: number;
  kind: string;
  amount: number;
  base: number;
  rate: number;
  status: "pending" | "approved" | "paid" | "reversed";
  createdAt: number;
  releaseAt: number | null;
  customer: string;
};

export type Payout = {
  id: string;
  amount: number;
  method: string;
  destination: string;
  status: "requested" | "approved" | "paid" | "rejected";
  note: string;
  utr: string;
  requestedAt: number;
  decidedAt: number | null;
};

export type Referral = {
  code: string;
  joinedAt: number;
  deposited: number;
  earned: number;
  pending: number;
  country: string;
  landing: string;
  campaign: string;
};

export type Plan = {
  id: string;
  name: string;
  model: string;
  modelLabel: string;
  depositRate: number;
  revRate: number;
  holdDays: number;
  minPayout: number;
};

export type MePayload = {
  affiliate: Partner;
  summary: Summary;
  series: Point[];
  recentReferrals: Referral[];
  recentCommissions: Commission[];
  plans: Plan[];
  openPayout: Payout | null;
};

type Ctx = {
  me: MePayload | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Local patch so a payout request updates the header instantly. */
  patch: (s: Partial<Summary>) => void;
  toast: (message: string, tone?: ToastTone) => void;
};

export type ToastTone = "ok" | "err" | "info";
export type ToastMsg = { id: number; message: string; tone: ToastTone };

const PartnerCtx = createContext<Ctx | null>(null);

export function PartnerProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    pGet<MePayload>("/me?days=30")
      .then((data) => {
        if (!live) return;
        setMe(data);
        setError(null);
      })
      .catch((e) => {
        if (live) setError(e?.message || "Could not load your panel");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const patch = useCallback((s: Partial<Summary>) => {
    setMe((cur) => (cur ? { ...cur, summary: { ...cur.summary, ...s } } : cur));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const value = useMemo(
    () => ({ me, loading, error, reload, patch, toast }),
    [me, loading, error, reload, patch, toast],
  );

  return (
    <PartnerCtx.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} />
    </PartnerCtx.Provider>
  );
}

export function usePartner() {
  const ctx = useContext(PartnerCtx);
  if (!ctx) throw new Error("usePartner must be used inside PartnerProvider");
  return ctx;
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+62px)] z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-xl border px-3.5 py-2 text-[12.5px] font-medium shadow-lg backdrop-blur-xl ${
            t.tone === "ok"
              ? "border-positive/30 bg-positive/12 text-positive"
              : t.tone === "err"
                ? "border-negative/30 bg-negative/12 text-negative"
                : "border-border bg-card/95 text-foreground"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
