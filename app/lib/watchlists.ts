"use client";
export type WL = {
  name: string;
  symbols: string[];
  notes: Record<string, string>;
};
const K = "fs_watchlists";
export function getWLs(): WL[] {
  try {
    const l = JSON.parse(localStorage.getItem(K) || "[]");
    if (l.length) return l;
  } catch {
    /* seed below */
  }
  return [{ name: "Default", symbols: [], notes: {} }];
}
export function saveWLs(l: WL[]) {
  localStorage.setItem(K, JSON.stringify(l));
}
