"use client";
import { useEffect } from "react";
import { getCookie } from "cookies-next";
import { apiURL } from "@/app/components/apiURL";

// Reports this browser's identity to the admin registry once per visit.
// Sends username/email/clientID + PAN last-4 + KYC + cash only —
// never full PAN, passwords, or tokens. Frozen accounts get logged out.
export default function ClientHeartbeat() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The admin console has its own session cookie but no client account,
        // so skip it entirely: no /auth/getAccountDetails (401) and no empty
        // heartbeat on every admin page load.
        if (window.location.pathname.startsWith("/admin")) return;
        const token = getCookie("token") as string | undefined;
        const username = (getCookie("username") as string | undefined) || "";
        const email = (getCookie("email") as string | undefined) || "";
        const clientID = (getCookie("clientID") as string | undefined) || "";
        // A session without any identity has nothing to report.
        if (!username && !email && !clientID) return;

        let panLast4 = "";
        let kyc = "UNKNOWN";
        let cash: number | undefined;
        if (token) {
          try {
            const r = await fetch(apiURL + "/auth/getAccountDetails", {
              method: "POST",
              headers: { Authorization: "Bearer " + token },
            });
            if (r.ok) {
              const d = await r.json();
              const pan: string =
                d?.pan || d?.PAN || d?.panNumber || d?.Pan || "";
              panLast4 = String(pan).replace(/\D/g, "").slice(-4);
              const kRaw =
                d?.kyc ?? d?.kycStatus ?? d?.KYC ?? d?.verified ?? "UNKNOWN";
              kyc =
                kRaw === true || String(kRaw).toUpperCase() === "VERIFIED"
                  ? "VERIFIED"
                  : String(kRaw || "UNKNOWN")
                      .toUpperCase()
                      .slice(0, 16);
              if (typeof d?.remainingCash === "number") {
                cash = d.remainingCash;
                // Prime the wallet cache the ledger reads, so an order
                // placed before the portfolio page loads is not rejected as
                // "₹0 in wallet".
                try {
                  const { setBackendCash } = await import("@/app/lib/trading");
                  setBackendCash(d.remainingCash);
                } catch {
                  /* ignore */
                }
              }
            }
          } catch {
            /* registry still gets cookie identity */
          }
        }
        const res = await fetch("/api/client/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            email,
            clientID,
            panLast4,
            kyc,
            cash,
          }),
        });
        if (!cancelled && res.ok) {
          const j = await res.json();
          if (j?.frozen) {
            try {
              const { deleteCookie } = await import("cookies-next");
              deleteCookie("token");
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* never break the app for telemetry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
