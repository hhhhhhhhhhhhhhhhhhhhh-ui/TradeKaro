"use client";
import { useEffect, useMemo, useState } from "react";
import { apiURL } from "@/app/components/apiURL";
import axios from "axios";
import {
  applyFill,
  executeFill,
  getBackendCash,
  getPositions,
  getWalletBalance,
  logTrade,
  marginFor,
  submitFill,
  useTradingAccount,
  type FillSide,
  type TradePos,
} from "@/app/lib/trading";
import { livePriceFor, useLivePnl } from "@/app/hooks/useLivePnl";
import { useMounted } from "@/app/hooks/useMounted";
import { money, num, pnlSigned } from "@/app/lib/format";
import {
  getClosedPositions,
  getOpenSince,
  type ClosedPosition,
} from "@/app/lib/closedBook";
import PositionSheet from "./PositionSheet";
import MisSquareOffNotice from "./MisSquareOffNotice";
import { legKey } from "@/app/lib/positionKeys";
import { FiChevronDown, FiSearch, FiShoppingCart } from "react-icons/fi";
import { sileo } from "sileo";

export type Pos = TradePos;
export { getPositions };

// Thin wrapper over the ledger's `applyFill` that also writes the tradebook.
// Kept at module scope so OrderTicket / BasketPanel / Builder keep importing it
// from here; the name differs from the imported one to avoid shadowing.
export function recordFill(
  scrip: string,
  qty: number,
  price: number,
  side: "BUY" | "SELL",
  meta?: Partial<TradePos>,
) {
  applyFill(scrip, qty, price, side as FillSide, {
    kind: "STOCK",
    ...meta,
  });
  const kind = meta?.kind ?? "STOCK";
  const entry = logTrade({
    scrip,
    side: side as FillSide,
    qty,
    price,
    kind,
    // Carry the leg metadata into the tradebook as well. Without it a locally
    // logged fill had no `product`, so the Closed tab could not tell an MIS
    // round-trip from a carry one until the next server sync replaced the book.
    product: meta?.product,
    underlying: meta?.underlying,
    expiry: meta?.expiry,
    strike: meta?.strike,
    optionSide: meta?.optionSide,
    lotSize: meta?.lotSize,
  });
  // Same rule as executeFill: a fill only counts once the server ledger
  // accepts it, so this path cannot be used to write straight to the book.
  void submitFill({
    entry,
    kind,
    product: meta?.product,
    underlying: meta?.underlying,
    expiry: meta?.expiry,
    strike: meta?.strike,
    optionSide: meta?.optionSide,
    lotSize: meta?.lotSize,
  });
}

// ── the three book views ────────────────────────────────────────────────────
// Position = carry legs (CNC) · Active = intraday legs (MIS) that the EOD
// square-off will flatten · Closed = finished round-trips from the tradebook.
type Tab = "CLOSED" | "POSITION" | "ACTIVE";
const TAB_ORDER: Tab[] = ["CLOSED", "POSITION", "ACTIVE"];
const TAB_LABEL: Record<Tab, string> = {
  CLOSED: "Closed",
  POSITION: "Position",
  ACTIVE: "Active",
};

function hhmmss(at?: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/** "2026-09-22" → "22 Sep". Falls back to the raw string when unparseable. */
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

/** Right-hand caption of row 3: the instrument, not the side. */
function instrumentLabel(p: TradePos | ClosedPosition): string {
  if (p.kind !== "OPTION") return "EQ";
  const leg =
    p.strike != null
      ? `${p.strike}${p.optionSide ?? ""}`
      : (p.optionSide ?? "");
  return [fmtExpiry(p.expiry), leg].filter(Boolean).join(" ");
}

/** Row 1: `BUY 🛒 12`. Quantity is signed on the sell side, as in the reference. */
function SideQty({ short, qty }: { short: boolean; qty: number }) {
  return (
    <>
      <span className={`pr-side ${short ? "is-sell" : "is-buy"}`}>
        {short ? "SELL" : "BUY"}
      </span>
      <span className={`pr-qty ${short ? "is-sell" : "is-buy"}`}>
        <FiShoppingCart size={13} strokeWidth={2.5} aria-hidden />
        {short ? `-${qty}` : `${qty}`}
      </span>
    </>
  );
}

export default function PositionsPanel(props: { refreshKey?: number }) {
  const { positions, optPx, ticks, unrealized, refresh } = useLivePnl();
  const acct = useTradingAccount();
  const mounted = useMounted();

  // The panel owns its own revision counter so it works standalone on /positions
  // as well as embedded in the portfolio tabs — no parent wiring required.
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const h = () => setRev((t) => t + 1);
    window.addEventListener("storage", h);
    window.addEventListener("fs-ledger", h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener("fs-ledger", h);
    };
  }, []);
  const revKey = (props.refreshKey ?? 0) + rev;

  // null = "follow the content". Only a click pins it.
  const [pinned, setPinned] = useState<Tab | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tradebook-derived views. `fs_tradebook` lives in localStorage, so these are
  // gated on mount like every other local read on this screen.
  const closed = useMemo<ClosedPosition[]>(
    () => (mounted ? getClosedPositions() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, revKey],
  );
  const openedAt = useMemo<Record<string, number>>(
    () => (mounted ? getOpenSince() : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, revKey],
  );

  function optLtp(p: Pos): number | null {
    if (
      p.kind !== "OPTION" ||
      !p.underlying ||
      p.strike == null ||
      !p.optionSide
    )
      return null;
    const v =
      optPx[`${p.underlying}|${p.expiry || ""}|${p.strike}${p.optionSide}`];
    return typeof v === "number" && v > 0 ? v : null;
  }

  function priceOf(p: Pos) {
    const tick = ticks[p.scrip.toUpperCase()];
    const ltp = livePriceFor(p, optPx, tick?.ltp);
    // Distinguish "no price yet" from "price equals my average". The fallback in
    // livePriceFor silently returns avg, which used to read as a flat position.
    const known = p.kind === "OPTION" ? optLtp(p) != null : tick?.ltp != null;
    return { tick, ltp, known };
  }

  // Intraday (MIS) legs are the ones the cutoff will flatten; everything else
  // carries. Legacy rows with no product are treated as carry.
  const active = positions.filter((p) => p.product === "MIS");
  const carry = positions.filter((p) => p.product !== "MIS");

  const q = query.trim().toLowerCase();
  const keep = (s: string) => !q || s.toLowerCase().includes(q);
  const rows = {
    CLOSED: closed.filter((c) => keep(c.scrip)),
    POSITION: carry.filter((p) => keep(p.scrip)),
    ACTIVE: active.filter((p) => keep(p.scrip)),
  };
  const counts = {
    CLOSED: closed.length,
    POSITION: carry.length,
    ACTIVE: active.length,
  };

  // Landing tab follows the content until the user picks one, so nobody ever
  // arrives on an empty tab while holding positions.
  const tab: Tab =
    pinned ??
    (carry.length ? "POSITION" : active.length ? "ACTIVE" : "POSITION");

  function mtmOf(p: Pos) {
    const { ltp } = priceOf(p);
    return (ltp - p.avg) * p.qty;
  }

  // TOTAL P&L is the arithmetic sum of the rows on screen.
  const total = useMemo(() => {
    if (tab === "CLOSED") return closed.reduce((a, c) => a + c.netPnl, 0);
    const list = tab === "ACTIVE" ? active : carry;
    return list.reduce((a, p) => a + mtmOf(p), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    closed,
    JSON.stringify(active),
    JSON.stringify(carry),
    optPx,
    ticks,
  ]);

  // ── ledger strip ──────────────────────────────────────────────────────────
  // Ledger balance = startCash + realised − charges, which is exactly
  // freeMargin + marginUsed on the server's derived account. When the account has
  // never synced, fall back to the local wallet so the strip is never blank.
  const gross = positions.reduce(
    (a, p) => a + Math.abs(p.qty) * priceOf(p).ltp,
    0,
  );
  const ledger = acct
    ? acct.freeMargin + acct.marginUsed
    : mounted
      ? getWalletBalance(getBackendCash())
      : 0;
  const marginUsed = acct ? acct.marginUsed : marginFor(gross);
  const marginAvail = acct ? acct.freeMargin : Math.max(0, ledger - marginUsed);

  // ── trading ───────────────────────────────────────────────────────────────
  // One path for every action so EXIT / ADD MORE / PARTIAL EXIT / FLIP can never
  // drift apart in what they do to the book.
  async function fillLeg(p: Pos, side: FillSide, qty: number, ltp: number) {
    const isOption = p.kind === "OPTION";
    if (!isOption) {
      // Mirror the trade onto the real broker book, exactly as before.
      try {
        const token = document.cookie.match(/token=([^;]+)/)?.[1];
        await axios({
          method: "post",
          url:
            apiURL +
            (side === "SELL"
              ? "/transaction/sellScrip"
              : "/transaction/buyScrip"),
          headers: { Authorization: "Bearer " + token },
          data: { scrip: p.scrip, quantity: qty },
        });
      } catch {
        /* paper */
      }
    }
    if (isOption) {
      executeFill({
        scrip: p.scrip,
        qty,
        price: ltp,
        side,
        kind: "OPTION",
        // Must carry the leg's product. Positions are keyed by (scrip, product),
        // so closing an MIS option without it would book a CNC fill and leave the
        // intraday leg untouched while opening a phantom delivery row.
        product: p.product,
        backendCash: getBackendCash(),
        underlying: p.underlying,
        expiry: p.expiry,
        strike: p.strike,
        optionSide: p.optionSide,
        lotSize: p.lotSize ?? 1,
        // Options are NFO, which runs to 15:40 rather than 15:30.
        segment: "NFO",
      });
    } else {
      recordFill(p.scrip, qty, ltp, side, { product: p.product });
    }
  }

  /** action: "exit" and "add" act on `qty` units; "flip" doubles the leg. */
  async function run(
    p: Pos,
    ltp: number,
    action: "exit" | "add" | "flip",
    qty?: number,
  ) {
    if (busy) return;
    setBusy(true);
    const held = Math.abs(p.qty);
    const long = p.qty > 0;
    // "add" trades WITH the position; "exit" and "flip" trade against it.
    const side: FillSide =
      action === "add" ? (long ? "BUY" : "SELL") : long ? "SELL" : "BUY";
    const units =
      action === "flip" ? held * 2 : Math.max(1, Math.min(held, qty ?? held));
    try {
      await fillLeg(p, side, units, ltp);
    } catch (e: any) {
      sileo.error({ title: e?.message || `${action} blocked` });
      setBusy(false);
      return;
    }
    refresh();
    setBusy(false);
    if (action === "exit") {
      // A partial exit leaves the position open, so the sheet stays up and
      // simply re-renders against the smaller size.
      if (units >= held) setSelKey(null);
      sileo.success({
        title:
          units >= held
            ? `Squared off ${p.scrip}`
            : `Exited ${units} of ${held} ${p.scrip}`,
      });
    } else if (action === "add") {
      sileo.success({ title: `Added ${units} to ${p.scrip}` });
    } else {
      sileo.success({ title: `Flipped ${p.scrip}` });
    }
  }

  // Leg identity, not scrip: one name can hold a delivery position AND an
  // intraday leg at the same time, and they open separate sheets.
  const selected = selKey
    ? (positions.find((p) => legKey(p.scrip, p.product) === selKey) ?? null)
    : null;
  const selPrice = selected ? priceOf(selected) : null;
  const rowCount = rows[tab].length;
  // The reference prints an explicit sign with a plain hyphen-minus.
  const plain = (v: number) => pnlSigned(v).replace("−", "-");

  return (
    <>
      <div className="pr pr-surface">
        {/* ── ledger strip (collapsed until the chevron opens it, as in the
               reference where it renders as a 1px line on load) ── */}
        {ledgerOpen && (
          <div className="pr-ledger">
            <div className="pr-ledger-item">
              <div className="pr-ledger-label">Ledger Balance</div>
              <div className="pr-ledger-value">{num(ledger, 2)}</div>
            </div>
            <div className="pr-ledger-item">
              <div className="pr-ledger-label">Margin Available</div>
              <div className="pr-ledger-value">{num(marginAvail, 2)}</div>
            </div>
            <div className="pr-ledger-item">
              <div className="pr-ledger-label">Margin Used</div>
              <div className="pr-ledger-value">{num(marginUsed, 2)}</div>
            </div>
            <div className="pr-ledger-item">
              <div className="pr-ledger-label">M2M</div>
              <div
                className="pr-ledger-value is-signed"
                style={{
                  color:
                    unrealized >= 0
                      ? "rgb(var(--pr-up))"
                      : "rgb(var(--pr-down))",
                }}
              >
                {unrealized >= 0 ? "+" : "−"}
                <span>₹</span>
                <span>{num(Math.abs(unrealized), 2)}</span>
              </div>
            </div>
          </div>
        )}

        {searchOpen && (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search positions"
            className="pr-search"
          />
        )}

        {/* ── tabs ── */}
        <div role="tablist" aria-label="Position views" className="pr-tabs">
          {TAB_ORDER.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setPinned(id);
                setSelKey(null);
              }}
              className={`pr-tab ${tab === id ? "is-active" : ""}`}
            >
              {TAB_LABEL[id]}
              <span className="pr-tab-count">{counts[id]}</span>
            </button>
          ))}
          <div className="pr-tabs-icons">
            <button
              onClick={() => setSearchOpen((s) => !s)}
              aria-label="Search positions"
              className="pressable bg-transparent p-0 text-inherit"
            >
              <FiSearch size={16} />
            </button>
            <button
              onClick={() => setLedgerOpen((s) => !s)}
              aria-expanded={ledgerOpen}
              aria-label={ledgerOpen ? "Hide ledger" : "Show ledger"}
              className="pressable bg-transparent p-0 text-inherit"
            >
              <FiChevronDown
                size={16}
                style={{
                  transform: ledgerOpen ? "rotate(180deg)" : "none",
                  transition: "transform .18s ease",
                }}
              />
            </button>
          </div>
        </div>

        {/* ── total P&L = the sum of the rows below ── */}
        <MisSquareOffNotice count={active.length} />

        <div className="pr-pnl">
          <div className="pr-pnl-label">Total P&amp;L</div>
          <div
            className="pr-pnl-value"
            style={{
              color: total >= 0 ? "rgb(var(--pr-up))" : "rgb(var(--pr-down))",
            }}
          >
            {rowCount ? plain(total) : "—"}
          </div>
        </div>

        {/* ── rows ── */}
        {rowCount === 0 ? (
          <div className="pr-empty">
            {q
              ? `No ${TAB_LABEL[tab].toLowerCase()} rows match “${query}”.`
              : tab === "CLOSED"
                ? "No closed round-trips yet."
                : tab === "ACTIVE"
                  ? "No intraday legs open."
                  : "No positions."}
          </div>
        ) : tab === "CLOSED" ? (
          <div className="pr-list">
            {rows.CLOSED.map((c) => {
              const up = c.netPnl >= 0;
              const short = c.side === "SHORT";
              return (
                <div key={c.key} className="pr-card">
                  <div className="pr-card-inner">
                    <div className="pr-row pr-row-1">
                      <div className="pr-left">
                        <SideQty short={short} qty={c.qty} />
                      </div>
                      <div className="pr-right">
                        <span className={`pr-time ${up ? "is-up" : "is-down"}`}>
                          {hhmmss(c.closedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="pr-row pr-row-2">
                      <div className="pr-left">
                        <span className="pr-symbol">{c.scrip}</span>
                      </div>
                      <div className="pr-right">
                        <span
                          className="pr-delta"
                          style={{
                            color: up
                              ? "rgb(var(--pr-up))"
                              : "rgb(var(--pr-down))",
                          }}
                        >
                          {plain(c.netPnl)}
                        </span>
                      </div>
                    </div>
                    <div className="pr-row pr-row-3">
                      <div className="pr-left">
                        <span className="pr-sub">{instrumentLabel(c)}</span>
                      </div>
                      <div className="pr-right">
                        <span className="pr-sub">
                          {" "}
                          In: {money(c.avgEntry, 2)} | Out:{" "}
                          {money(c.avgExit, 2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pr-list">
            {rows[tab as "POSITION" | "ACTIVE"].map((p) => {
              const { ltp, known } = priceOf(p);
              const mtm = (ltp - p.avg) * p.qty;
              const up = mtm >= 0;
              const short = p.qty < 0;
              return (
                <div key={p.scrip} className="pr-card">
                  <button
                    onClick={() => setSelKey(legKey(p.scrip, p.product))}
                    aria-label={`${p.scrip} position — open details`}
                    className="pr-card-inner"
                  >
                    <div className="pr-row pr-row-1">
                      <div className="pr-left">
                        <SideQty short={short} qty={Math.abs(p.qty)} />
                      </div>
                      <div className="pr-right">
                        <span className={`pr-time ${up ? "is-up" : "is-down"}`}>
                          {hhmmss(openedAt[legKey(p.scrip, p.product)])}
                        </span>
                      </div>
                    </div>
                    <div className="pr-row pr-row-2">
                      <div className="pr-left">
                        <span className="pr-symbol">{p.scrip}</span>
                      </div>
                      <div className="pr-right">
                        <span
                          className="pr-delta"
                          style={{
                            color: up
                              ? "rgb(var(--pr-up))"
                              : "rgb(var(--pr-down))",
                          }}
                        >
                          {plain(mtm)}
                        </span>
                      </div>
                    </div>
                    <div className="pr-row pr-row-3">
                      <div className="pr-left">
                        <span className="pr-sub">{instrumentLabel(p)}</span>
                      </div>
                      <div className="pr-right">
                        <span className="pr-sub">
                          {" "}
                          Avg: {money(p.avg, 2)} | LTP:{" "}
                          {known ? money(ltp, 2) : "—"}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── position detail sheet ── */}
      {selected && selPrice ? (
        <PositionSheet
          pos={selected}
          ltp={selPrice.ltp}
          ltpKnown={selPrice.known}
          tick={selPrice.tick}
          busy={busy}
          onClose={() => setSelKey(null)}
          onExit={(qty) => void run(selected, selPrice.ltp, "exit", qty)}
          onAdd={(qty) => void run(selected, selPrice.ltp, "add", qty)}
        />
      ) : null}
    </>
  );
}
