"use client";
import { useEffect } from "react";
import { sileo } from "sileo";
import { getAlerts, markHit } from "@/app/lib/alerts";
import {
  getPending,
  savePending,
  shouldTrigger,
} from "@/app/lib/pendingOrders";
import { executeFill, getBackendCash, initLedgerSync } from "@/app/lib/trading";
import { ensureInstrument } from "@/app/hooks/useInstrument";
import { getPublicConfig } from "@/app/hooks/usePublicConfig";
import { getApiURL } from "@/app/components/apiURL";
import axios from "axios";
import { getCookie } from "cookies-next";

// Polls pending LIMIT/SL/GTT + price alerts against live LTP.
// Triggered stock orders settle into the ledger so the
// wallet, positions and tradebook stay in sync.
// Interval + halt flag follow the admin panel (/api/admin/public).
export default function TradeEngine() {
  useEffect(() => {
    initLedgerSync().catch(() => {});
    // The server is the ledger: it can refuse a fill the browser accepted
    // (stale price, tampered book, risk rule). Surface that instead of letting
    // the trade silently vanish when the mirror snaps back.
    const onRejected = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      sileo.error({ title: String(detail || "Order rejected") });
    };
    window.addEventListener("fs-ledger-rejected", onRejected);
    let ms = 5000;
    let halted = false;
    fetch("/api/admin/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (Number.isFinite(j.tradeEngineMs))
          ms = Math.max(2000, Math.min(30000, j.tradeEngineMs));
        halted = !!j?.trading?.haltFills;
      })
      .catch(() => {});
    const id = setInterval(async () => {
      try {
        if (halted) return;
        const pending = getPending().filter((o) => o.status === "PENDING");
        const alerts = getAlerts().filter((a) => !a.hit);
        const symbols = Array.from(
          new Set([
            ...pending.map((o) => o.scrip),
            ...alerts.map((a) => a.scrip),
          ]),
        ).slice(0, 10);
        if (!symbols.length) return;
        const r = await fetch("/api/market/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols }),
        });
        const j = await r.json();
        const map: Record<string, number> = {};
        for (const t of j.ticks || [])
          map[String(t.symbol).toUpperCase()] = t.ltp;

        // Alerts
        for (const a of alerts) {
          const ltp = map[a.scrip.toUpperCase()];
          if (ltp == null) continue;
          if (
            (a.op === ">=" && ltp >= a.price) ||
            (a.op === "<=" && ltp <= a.price)
          ) {
            sileo.success({
              title: `Alert: ${a.scrip} ${a.op} ₹${a.price} (LTP ₹${ltp.toFixed(2)})`,
            });
            markHit(a.id);
          }
        }

        // Pending orders
        const token = getCookie("token") as string | undefined;
        for (const o of pending) {
          const ltp = map[o.scrip.toUpperCase()];
          if (ltp == null || !shouldTrigger(o, ltp)) continue;
          const fillPrice =
            o.orderType === "LIMIT" && o.limitPrice
              ? o.limitPrice
              : o.orderType !== "MARKET" && o.triggerPrice
                ? o.triggerPrice
                : ltp;
          // Local paper engine settles the fill; backend records it.
          //
          // The instrument is resolved first because the segment decides which
          // exchange's session is checked. A commodity LIMIT parked in the
          // afternoon fills in the evening, and the default NSE check cancelled
          // it outright instead of filling it.
          const meta = await ensureInstrument(o.scrip);
          try {
            executeFill({
              scrip: o.scrip,
              qty: o.qty,
              price: fillPrice,
              side: o.side,
              kind: "STOCK",
              product: o.product,
              backendCash: getBackendCash(),
              segment: meta?.segment,
            });
          } catch (e: any) {
            o.status = "CANCELLED";
            sileo.error({
              title: `${o.orderType} ${o.side} ${o.qty} ${o.scrip} blocked — ${e?.message || "insufficient funds"}`,
            });
            continue;
          }
          if (token) {
            axios({
              method: "post",
              url:
                getApiURL() +
                (o.side === "BUY"
                  ? "/transaction/buyScrip"
                  : "/transaction/sellScrip"),
              headers: { Authorization: "Bearer " + token },
              data: { scrip: o.scrip, quantity: o.qty },
            }).catch(() => {});
          }
          o.status = "DONE";
          sileo.success({
            title: `${o.orderType} ${o.side} ${o.qty} ${o.scrip} fired @ ₹${fillPrice.toFixed(2)}`,
          });
        }
        savePending(
          getPending().map((o) => pending.find((p) => p.id === o.id) || o),
        );
      } catch {
        /* ignore */
      }
    }, ms);
    return () => clearInterval(id);
  }, []);

  // The EOD MIS square-off used to run here, once per day, driven by a
  // localStorage flag. It was moved to the server (see `sweepMisSquareOff` in
  // app/lib/tradingServer.ts) for two reasons: it only ever fired while a tab
  // was open, which is precisely when it is not needed, and the per-day flag
  // meant a browser that first loaded after the cutoff marked the day done
  // without closing anything. The risk sweep now runs next to the ledger,
  // keyed off the cutoff rather than the close, and does not depend on the
  // customer watching. Position warnings live in the Positions panel.

  return null;
}
