"use client";
import { useEffect, useMemo, useState } from "react";
import OptionChain from "./components/OptionChain";
import ChainStatsStrip from "./components/ChainStatsStrip";
import OptionTicket, { type TicketSel } from "./components/OptionTicket";
import SectionHeader from "@/app/dashboard/components/SectionHeader";
import LivePnlStrip from "@/app/components/LivePnlStrip";
import useHasSession from "@/app/hooks/useHasSession";
import { useLiveTicks } from "@/app/hooks/useLiveTicks";
import { lotSizeFor } from "./components/lots";
import { getPositions } from "@/app/lib/trading";
import type { ChainRow } from "./components/optTypes";

const PRESETS: { sym: string; label: string; hint: string }[] = [
  { sym: "NIFTY", label: "NIFTY", hint: "IDX" },
  { sym: "BANKNIFTY", label: "BANKNIFTY", hint: "IDX" },
  { sym: "FINNIFTY", label: "FINNIFTY", hint: "IDX" },
  { sym: "SENSEX", label: "SENSEX", hint: "IDX" },
  { sym: "BANKEX", label: "BANKEX", hint: "IDX" },
  { sym: "NIFTYNXT50", label: "NXT50", hint: "IDX" },
  { sym: "RELIANCE", label: "RELIANCE", hint: "EQ" },
  { sym: "TCS", label: "TCS", hint: "EQ" },
  { sym: "INFY", label: "INFY", hint: "EQ" },
];

function dte(expiry: string): string {
  const t = Date.parse(expiry);
  if (!Number.isFinite(t)) return "";
  const days = Math.max(0, Math.ceil((t - Date.now()) / 86400000));
  return `${days}D`;
}

export default function OptionsPage() {
  // The desk itself is public; only the account-shaped bits below are gated.
  const hasSession = useHasSession();
  const [u, setU] = useState("NIFTY");
  const [sel, setSel] = useState<TicketSel>(null);
  // A contract deep link waiting for the chain to load. The search can name a
  // strike before we know which strikes exist, so the ticket opens on the
  // nearest listed strike once the rows arrive.
  const [pending, setPending] = useState<{
    strike: number;
    side: "CE" | "PE";
  } | null>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [, setAtm] = useState(0);
  const [expiry, setExpiry] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const { ticks, live } = useLiveTicks([u], 3000);
  const ltp = ticks[u]?.ltp ?? 0;
  const lot = lotSizeFor(u);
  const openLegs = useMemo(
    () =>
      getPositions().filter((p) => p.kind === "OPTION" && p.underlying === u)
        .length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, refreshKey, sel],
  );

  // Deep link: /options?underlying=NIFTY&strike=23400&side=CE
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sym = (sp.get("underlying") || "").toUpperCase();
    const strike = Number(sp.get("strike"));
    const side = (sp.get("side") || "").toUpperCase();
    if (sym) setU(sym);
    if (
      Number.isFinite(strike) &&
      strike > 0 &&
      (side === "CE" || side === "PE")
    )
      setPending({ strike, side });
  }, []);

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-20">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <span className={`live-dot ${live ? "" : "opacity-40"}`} />
              Options desk {live ? "· live Upstox" : "· offline"}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
              Option chain
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Tap a CE / PE price to trade it — one tap, one ticket.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
            <span className="broker-pill px-3 py-1 border border-border bg-muted display-num">
              {u} @{" "}
              {ltp
                ? `₹${ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                : "— loading live price…"}
            </span>
            <span className="broker-pill px-3 py-1 border border-border bg-card display-num">
              LOT {lot}
            </span>
            {expiry && (
              <span className="broker-pill px-3 py-1 border border-border bg-card display-num">
                {expiry} · {dte(expiry)}
              </span>
            )}
            {openLegs > 0 && (
              <a
                href="/portfolio"
                className="broker-pill px-3 py-1 border border-brand/40 bg-brand/10 text-brand"
              >
                {openLegs} OPEN →
              </a>
            )}
          </div>
        </div>

        <div
          className="broker-card px-3 sm:px-4 py-3 flex gap-2 overflow-x-auto"
          role="tablist"
          aria-label="Underlyings"
        >
          {PRESETS.map((p) => (
            <button
              key={p.sym}
              role="tab"
              aria-selected={u === p.sym}
              onClick={() => {
                setU(p.sym);
                setSel(null);
              }}
              className={`pressable flex h-[36px] shrink-0 items-center gap-2 rounded-md border px-4 text-[12px] font-medium transition-colors ${u === p.sym ? "border-transparent bg-foreground text-background" : "border-border bg-card hover:bg-muted"}`}
            >
              {p.label}
              <span
                className={`text-[9px] px-1.5 py-px broker-pill ${u === p.sym ? "bg-white/20" : "bg-muted text-foreground/50"}`}
              >
                {p.hint}
              </span>
            </button>
          ))}
        </div>

        <ChainStatsStrip
          rows={rows}
          ltp={ltp}
          live={live}
          expiry={expiry}
          count={rows.length}
        />

        <LivePnlStrip compact />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 sm:gap-5 items-start">
          <div className="min-w-0">
            <SectionHeader eyebrow="Chain" count={`${rows.length} strikes`} />
            <OptionChain
              underlying={u}
              ltp={ltp}
              onAddLeg={(l) =>
                setSel({
                  strike: l.strike,
                  side: l.side,
                  action: l.action,
                  price: l.price,
                })
              }
              onStats={(r, a, e) => {
                setRows(r);
                setAtm(a);
                setExpiry(e);
                // Open the deep-linked leg on the nearest listed strike.
                if (pending && r.length) {
                  const near = r.reduce((best, row) =>
                    Math.abs(row.strike - pending.strike) <
                    Math.abs(best.strike - pending.strike)
                      ? row
                      : best,
                  );
                  const px = pending.side === "CE" ? near.ceLtp : near.peLtp;
                  setSel({
                    strike: near.strike,
                    side: pending.side,
                    action: "BUY",
                    price: Number(px) || 0,
                  });
                  setPending(null);
                  // Drop the query so a refresh does not reopen the ticket.
                  window.history.replaceState(null, "", "/options");
                }
              }}
            />
          </div>
          <div className="min-w-0 hidden xl:block xl:sticky xl:top-20">
            <SectionHeader
              eyebrow="Ticket"
              count={sel ? "1 leg" : "empty"}
              href={hasSession ? "/portfolio" : undefined}
              linkLabel="POSITIONS →"
            />
            <OptionTicket
              underlying={u}
              expiry={expiry}
              ltp={ltp}
              rows={rows}
              sel={sel}
              onClear={() => setSel(null)}
              onFilled={() => {
                setSel(null);
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
        </div>
      </div>
      {sel && (
        <div
          className="xl:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Order ticket"
        >
          <button
            aria-label="Close ticket"
            onClick={() => setSel(null)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-background pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-2 shadow-2xl">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
            <div className="px-4">
              <OptionTicket
                underlying={u}
                expiry={expiry}
                ltp={ltp}
                rows={rows}
                sel={sel}
                onClear={() => setSel(null)}
                onFilled={() => {
                  setSel(null);
                  setRefreshKey((k) => k + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
