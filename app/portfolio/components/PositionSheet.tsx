"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiArrowDown,
  FiArrowUp,
  FiLogOut,
  FiMinus,
  FiPlus,
} from "react-icons/fi";
import { money, pnlSigned } from "@/app/lib/format";
import { type TradePos } from "@/app/lib/trading";
import type { Tick } from "@/app/hooks/useLiveTicks";

// Mirrors the reference action sheet 1:1 — grabber, symbol + tags + LTP/change,
// BID/ASK, OHLC, Current P&L + Exit All, then Add More / Partial Exit.
// There is deliberately no close button: the reference closes on overlay tap or
// drag, so this one closes on overlay tap (and Escape, for keyboards).

export type SheetAction = {
  /** Units to exit — always positive. */
  onExit: (qty: number) => void;
  /** Units to add in the position's own direction. */
  onAdd: (qty: number) => void;
};

type Props = {
  pos: TradePos;
  ltp: number;
  /** false = no live tick yet, so every price cell must read "—". */
  ltpKnown: boolean;
  tick?: Tick;
  busy?: boolean;
  onClose: () => void;
} & SheetAction;

function fmtExpiry(x?: string): string {
  if (!x) return "";
  const d = new Date(x.length === 10 ? `${x}T00:00:00Z` : x);
  if (Number.isNaN(d.getTime())) return x;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export default function PositionSheet(props: Props) {
  const { pos, ltp, ltpKnown, tick, busy } = props;
  const [step, setStep] = useState<"NONE" | "ADD" | "EXIT">("NONE");
  const [qty, setQty] = useState(1);

  const held = Math.abs(pos.qty);
  const short = pos.qty < 0;

  // Esc closes; the page behind is scroll-locked like any modal. The reference
  // has no close button, so these are the only two exits (plus the overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A partial exit must leave something behind, so it can never reach `held`.
  const canPartial = held > 1;
  const exitMax = Math.max(1, held - 1);
  const stepMax = (step === "EXIT" ? exitMax : held) || 1;

  useEffect(() => {
    setQty(Math.max(1, Math.min(stepMax, Math.ceil(stepMax / 2))));
  }, [step, stepMax]);

  const mtm = (ltp - pos.avg) * pos.qty;
  const up = mtm >= 0;

  // Day change is measured against the provider's previous close, never against
  // our entry — mixing the two made the number meaningless.
  const prevClose = tick?.close && tick.close > 0 ? tick.close : null;
  const chg = prevClose != null && ltpKnown ? ltp - prevClose : null;
  const chgPct =
    prevClose != null && prevClose !== 0 && ltpKnown
      ? ((ltp - prevClose) / prevClose) * 100
      : null;

  const bid = tick?.depth?.buy?.[0]?.price;
  const ask = tick?.depth?.sell?.[0]?.price;

  const ohlc = useMemo(
    () => [
      { k: "Open", v: tick?.open },
      { k: "High", v: tick?.high },
      { k: "Low", v: tick?.low },
      { k: "Close", v: tick?.close },
    ],
    [tick?.open, tick?.high, tick?.low, tick?.close],
  );

  if (typeof document === "undefined") return null;

  // Tag row: instrument · product · side — the reference's three badges.
  const instrument =
    pos.kind !== "OPTION"
      ? "EQ"
      : [
          fmtExpiry(pos.expiry),
          pos.strike != null ? `${pos.strike}${pos.optionSide ?? ""}` : "",
        ]
          .filter(Boolean)
          .join(" ");

  // The reference prints an explicit sign with a plain hyphen-minus.
  const plain = (v: number) => pnlSigned(v).replace("−", "-");

  return createPortal(
    <>
      <div className="pr-overlay" onClick={props.onClose} aria-hidden />
      <div className="pr-sheet-wrap">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${pos.scrip} position actions`}
          className="pr pr-sheet"
        >
          <div className="pr-grabber" />

          <div className="pr-sheet-head">
            <div className="pr-symbol-col">
              <div className="pr-symbol-name">{pos.scrip}</div>
              <div className="pr-tags">
                <span className="pr-badge">{instrument}</span>
                <span className="pr-badge">{pos.product ?? "CNC"}</span>
                <span className={`pr-badge ${short ? "is-sell" : "is-buy"}`}>
                  {short ? "Sell" : "Buy"}
                </span>
              </div>
            </div>
            <div className="pr-price-col">
              <div className="pr-ltp">{ltpKnown ? money(ltp, 2) : "—"}</div>
              <div className="pr-change">
                {chg != null && chgPct != null
                  ? ` ${plain(chg)} (${chgPct >= 0 ? "+" : "-"}${Math.abs(chgPct).toFixed(2)}%)`
                  : " —"}
              </div>
            </div>
          </div>

          <div className="pr-bidask">
            <div className="pr-ba">
              <span className="pr-ba-label">BID</span>
              <span className="pr-ba-value">{bid ? money(bid, 2) : "—"}</span>
            </div>
            <div className="pr-ba">
              <span className="pr-ba-label">ASK</span>
              <span className="pr-ba-value">{ask ? money(ask, 2) : "—"}</span>
            </div>
          </div>

          <div className="pr-ohlc">
            {ohlc.map((c) => (
              <div key={c.k} className="pr-ohlc-item">
                <span className="pr-ohlc-label">{c.k}</span>
                <span className="pr-ohlc-value">
                  {c.v ? money(c.v, 2) : "—"}
                </span>
              </div>
            ))}
          </div>

          <div className="pr-sheet-pnl">
            <div className="pr-sheet-pnl-left">
              <span className="pr-sheet-pnl-label">Current P&amp;L</span>
              <span
                className="pr-sheet-pnl-value"
                style={{
                  color: up ? "rgb(var(--pr-up))" : "rgb(var(--pr-down))",
                }}
              >
                {ltpKnown ? plain(mtm) : "—"}
              </span>
            </div>
            <button
              onClick={() => props.onExit(held)}
              disabled={busy || !ltpKnown}
              className="pr-exit-all pressable"
            >
              <FiLogOut size={13} aria-hidden /> Exit All
            </button>
          </div>

          {/* Quantity control for the two actions below. The reference opens the
              same kind of prompt from these buttons; it introduces no new action
              of its own, so neither does this. */}
          {step !== "NONE" && (
            <div className="pr-qtyrow">
              <span className="pr-sheet-pnl-label">
                {step === "ADD"
                  ? `Add to ${short ? "short" : "long"}`
                  : "Units to exit"}
              </span>
              <div className="pr-qtyctl">
                <button
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                  aria-label="Decrease quantity"
                  className="pressable"
                >
                  <FiMinus size={13} />
                </button>
                <input
                  type="number"
                  min={1}
                  max={stepMax}
                  value={qty}
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value));
                    setQty(
                      Number.isFinite(v)
                        ? Math.max(1, Math.min(stepMax, v))
                        : 1,
                    );
                  }}
                  className="pr-qtyinput"
                  aria-label="Quantity"
                />
                <button
                  onClick={() => setQty((n) => Math.min(stepMax, n + 1))}
                  aria-label="Increase quantity"
                  className="pressable"
                >
                  <FiPlus size={13} />
                </button>
              </div>
              <span className="pr-sub">
                of {step === "EXIT" ? exitMax : held}
                {ltpKnown ? ` · ${money(qty * ltp)}` : ""}
              </span>
            </div>
          )}

          <div className="pr-actions">
            <button
              onClick={() => {
                if (step === "ADD") {
                  props.onAdd(qty);
                  setStep("NONE");
                } else setStep("ADD");
              }}
              disabled={busy || !ltpKnown}
              className="pr-action is-add pressable"
            >
              <FiArrowUp size={14} aria-hidden />{" "}
              {step === "ADD" ? `Add More ${qty}` : "Add More"}
            </button>
            <button
              onClick={() => {
                if (step === "EXIT") {
                  props.onExit(qty);
                  setStep("NONE");
                } else setStep("EXIT");
              }}
              disabled={busy || !ltpKnown || (!canPartial && step !== "EXIT")}
              className="pr-action is-exit pressable"
            >
              <FiArrowDown size={14} aria-hidden />{" "}
              {step === "EXIT" ? `Partial Exit ${qty}` : "Partial Exit"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
