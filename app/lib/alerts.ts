"use client";
export type Alert = {
  id: string;
  scrip: string;
  op: ">=" | "<=";
  price: number;
  hit?: boolean;
};
const K = "fs_alerts";
export function getAlerts(): Alert[] {
  try {
    return JSON.parse(localStorage.getItem(K) || "[]");
  } catch {
    return [];
  }
}
export function addAlert(a: Omit<Alert, "id">) {
  const l = getAlerts();
  // Admin cap: read live limit, default 20.
  let cap = 20;
  try {
    const raw = sessionStorage.getItem("fs_alert_cap");
    if (raw) cap = Number(raw) || 20;
  } catch {
    /* ignore */
  }
  fetch("/api/admin/public", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (Number.isFinite(j?.alertLimits?.maxPerUser)) {
        try {
          sessionStorage.setItem(
            "fs_alert_cap",
            String(j.alertLimits.maxPerUser),
          );
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {});
  if (l.length >= cap) throw new Error(`Alert limit reached (${cap})`);
  l.push({ ...a, id: Math.random().toString(36).slice(2) });
  localStorage.setItem(K, JSON.stringify(l));
}
export function removeAlert(id: string) {
  localStorage.setItem(
    K,
    JSON.stringify(getAlerts().filter((a) => a.id !== id)),
  );
}
export function markHit(id: string) {
  localStorage.setItem(
    K,
    JSON.stringify(
      getAlerts().map((a) => (a.id === id ? { ...a, hit: true } : a)),
    ),
  );
}
