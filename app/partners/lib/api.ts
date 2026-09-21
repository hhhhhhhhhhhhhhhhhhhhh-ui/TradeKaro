"use client";

// Client helpers for the affiliate panel.
//
// Auth is cookie-based (`partner_token`, httpOnly: false by design — see the
// login route). Every call sends the cookie, and a 401 anywhere bounces the
// whole panel to the partner login rather than leaving a half-rendered page
// full of zeros.

const BASE = "/api/partners";

export class PartnerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}) as any);

  if (res.status === 401) {
    // Session gone or never existed. A full navigation (not a router push) so
    // the proxy re-evaluates the cookie and the login screen gets a clean slate.
    if (typeof window !== "undefined")
      window.location.replace(
        `/partners/login?next=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`,
      );
    throw new PartnerError("Session expired", 401);
  }

  if (!res.ok)
    throw new PartnerError(
      String(data?.error || "Something went wrong. Please try again."),
      res.status,
    );

  return data as T;
}

export const pGet = <T>(path: string) => request<T>(path);
export const pPost = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const pDelete = <T>(path: string) =>
  request<T>(path, { method: "DELETE" });

/** sha256 hex — the same shape the trader signup/login sends. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── formatting ──────────────────────────────────────────────────────────────

export const inr = (n: number, decimals = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

export const inrCompact = (n: number) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v);
};

export const num = (n: number) => Number(n || 0).toLocaleString("en-IN");

export function shortDate(ts: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function dayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** "in 12 days" / "ready" — for the holdback countdown. */
export function holdLabel(releaseAt: number | null) {
  if (!releaseAt) return "ready";
  const ms = releaseAt - Date.now();
  if (ms <= 0) return "ready";
  const days = Math.ceil(ms / 86400_000);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

export const STATUS_TONE: Record<
  string,
  "neutral" | "positive" | "negative" | "brand"
> = {
  pending: "neutral",
  requested: "brand",
  approved: "positive",
  paid: "positive",
  reversed: "negative",
  rejected: "negative",
  suspended: "negative",
};

export const STATUS_LABEL: Record<string, string> = {
  pending: "In holdback",
  requested: "Requested",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
  rejected: "Rejected",
};

/**
 * Commission rows use their own vocabulary.
 *
 * A commission is "in holdback" until its holdback elapses, then "released".
 * Whether it has been PAID is a property of the payout that carried it, not of
 * the commission, so there is deliberately no "paid" commission state to show.
 * Sharing `STATUS_LABEL` here produced a filter that could never match anything.
 */
export const COMMISSION_TONE: Record<
  string,
  "neutral" | "positive" | "negative" | "brand"
> = {
  pending: "neutral",
  approved: "positive",
  paid: "positive",
  reversed: "negative",
};

export const COMMISSION_LABEL: Record<string, string> = {
  pending: "In holdback",
  approved: "Released",
  paid: "Released",
  reversed: "Reversed",
};

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; plain-HTTP localhost on a LAN IP
    // does not have one. Fall back to a throwaway textarea + execCommand.
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}
