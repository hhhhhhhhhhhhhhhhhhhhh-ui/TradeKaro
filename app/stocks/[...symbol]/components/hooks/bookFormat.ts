"use client";

export function formatPrice(v: number | undefined | null): string {
  const n = Number(v ?? NaN);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQty(v: number | undefined | null): string {
  const n = Number(v ?? NaN);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// tsInMillis is already ms — no x1000 (the old moment(ts*1000) doubled it).
export function formatBookTime(tsMillis: number | null | undefined): string {
  if (!tsMillis || tsMillis <= 0) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(tsMillis));
}
