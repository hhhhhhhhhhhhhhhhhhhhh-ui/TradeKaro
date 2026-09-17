"use client";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "GTT";
export type Product = "CNC" | "MIS";

export type PendingOrder = {
  id: string;
  scrip: string;
  side: "BUY" | "SELL";
  qty: number;
  orderType: OrderType;
  limitPrice?: number;
  triggerPrice?: number;
  product: Product;
  createdAt: number;
  status: "PENDING" | "DONE" | "CANCELLED";
};

const KEY = "fs_pending_orders";

export function getPending(): PendingOrder[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
export function savePending(o: PendingOrder[]) {
  localStorage.setItem(KEY, JSON.stringify(o));
}
export function addPending(
  o: Omit<PendingOrder, "id" | "createdAt" | "status">,
) {
  const list = getPending();
  list.push({
    ...o,
    id: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    status: "PENDING",
  });
  savePending(list);
}
export function updatePending(id: string, patch: Partial<PendingOrder>) {
  savePending(getPending().map((o) => (o.id === id ? { ...o, ...patch } : o)));
}
export function cancelPending(id: string) {
  updatePending(id, { status: "CANCELLED" });
}
export function shouldTrigger(o: PendingOrder, ltp: number): boolean {
  if (o.status !== "PENDING") return false;
  if (o.orderType === "LIMIT") {
    if (o.side === "BUY") return ltp <= (o.limitPrice ?? Infinity);
    return ltp >= (o.limitPrice ?? 0);
  }
  if (o.orderType === "SL" || o.orderType === "GTT") {
    if (o.side === "BUY") return ltp >= (o.triggerPrice ?? Infinity);
    return ltp <= (o.triggerPrice ?? 0);
  }
  return false;
}
