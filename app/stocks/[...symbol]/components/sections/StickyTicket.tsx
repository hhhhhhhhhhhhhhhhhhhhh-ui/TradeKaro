"use client";
import { useEffect, useState } from "react";
import OrderTicket from "../handlers/OrderTicket";
import { getCookie } from "cookies-next";
import { useRouter } from "next/navigation";
import { FiX } from "react-icons/fi";

// Sits above StatusBar + docked bottom nav; opens ticket as bottom sheet.
export default function StickyTicket(props: {
  symbol: string;
  companyName: string;
  ltp: number;
}) {
  const [side, setSide] = useState<"BUY" | "SELL" | null>(null);
  const token = getCookie("token") as string | undefined;
  const router = useRouter();
  function open(s: "BUY" | "SELL") {
    if (!token) {
      router.push("/login");
      return;
    }
    setSide(s);
  }
  useEffect(() => {
    if (!side) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSide(null);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [side]);
  const price = props.ltp?.toFixed?.(2) ?? props.ltp;
  return (
    <>
      <div className="fixed inset-x-0 z-30 xl:hidden bottom-[calc(60px+env(safe-area-inset-bottom,0px))] md:bottom-8 px-3 pb-2 md:pb-0">
        <div className="grid grid-cols-2 gap-2 max-w-[520px] mx-auto">
          <button
            onClick={() => open("BUY")}
            className="min-h-[52px] py-3 text-sm font-mono font-semibold bg-positive text-positive-foreground active:scale-[0.98] transition-transform shadow-[0_8px_24px_rgba(38,166,154,0.35)]"
          >
            BUY ₹{price}
          </button>
          <button
            onClick={() => open("SELL")}
            className="min-h-[52px] py-3 text-sm font-mono font-semibold bg-negative text-negative-foreground active:scale-[0.98] transition-transform shadow-[0_8px_24px_rgba(239,83,80,0.35)]"
          >
            SELL
          </button>
        </div>
      </div>
      <div className="h-20 xl:hidden" />
      {side !== null && (
        <div
          className="fixed inset-0 z-50 xl:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            aria-label="Close order ticket"
            onClick={() => setSide(null)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] flex flex-col bg-card border-t-2 border-border animate-[sheet-up_0.25s_ease-out]">
            <div className="pt-2 pb-1 flex justify-center shrink-0">
              <span className="h-1 w-12 bg-border" />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span
                className={`text-sm font-mono font-bold ${side === "BUY" ? "text-positive" : "text-negative"}`}
              >
                {side} · {props.symbol} @ ₹{price}
              </span>
              <button
                onClick={() => setSide(null)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-foreground/60 transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <FiX size={18} aria-hidden />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain">
              <OrderTicket
                symbol={props.symbol}
                companyName={props.companyName}
                ltp={props.ltp}
                side={side}
                onClose={() => setSide(null)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
