"use client";
import { useEffect, useMemo, useState } from "react";
import EmptyState from "@/app/dashboard/components/EmptyState";
import {
  fmtOI,
  type ChainRow,
  type Leg,
} from "@/app/options/components/optTypes";

function segFor(u: string) {
  const t = u.toUpperCase();
  if (
    [
      "NIFTY",
      "BANKNIFTY",
      "FINNIFTY",
      "SENSEX",
      "BANKEX",
      "NIFTYNXT50",
    ].includes(t)
  )
    return "IDX_I";
  return "NSE_EQ";
}

// No mock data — empty means offline / no strikes from Upstox.

// Live chain table; price taps feed the single-leg ticket via onAddLeg.
export default function OptionChain(props: {
  underlying: string;
  ltp: number;
  onAddLeg: (leg: Omit<Leg, "id">) => void;
  onStats: (rows: ChainRow[], atm: number, expiry: string) => void;
}) {
  const [expiry, setExpiry] = useState("");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [atmOnly, setAtmOnly] = useState(false);
  const [money, setMoney] = useState<"ALL" | "ITM" | "OTM">("ALL");
  const [sort, setSort] = useState<"STRIKE" | "CE_OI" | "PE_OI">("STRIKE");
  const [q, setQ] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    async function fetchExpiries() {
      try {
        const r = await fetch("/api/market/expiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ underlying: props.underlying }),
        });
        const j = await r.json();
        if (!stop && r.ok && Array.isArray(j.expiries) && j.expiries.length) {
          setExpiries(j.expiries);
          setExpiry((e) => e || j.expiries[0]);
        }
      } catch {
        /* offline — rows stay empty, err shown below */
        if (!stop && expiries.length === 0)
          setErr("Expiries unavailable — feed offline");
      }
    }
    setExpiries([]);
    setExpiry("");
    fetchExpiries();
    return () => {
      stop = true;
    };
  }, [props.underlying]);

  useEffect(() => {
    let stop = false;
    async function load(quiet = false) {
      if (!quiet) setLoading(true);
      if (!quiet) setErr("");
      try {
        const r = await fetch("/api/market/optionchain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            underlying: props.underlying,
            segment: segFor(props.underlying),
            expiry,
          }),
        });
        const j = await r.json();
        if (stop) return;
        if (!r.ok) {
          if (!quiet) {
            setErr(j.error || "Live chain unavailable — feed offline");
            setRows([]);
          }
        } else {
          const direct: ChainRow[] = Array.isArray(j.rows)
            ? (j.rows as ChainRow[])
            : [];
          const oc = j.chain?.data?.oc || j.chain?.oc || {};
          const parsed: ChainRow[] = direct.length
            ? direct
            : Object.keys(oc).map((strike) => ({
                strike: Number(strike),
                ceLtp: oc[strike]?.ce?.last_price ?? 0,
                peLtp: oc[strike]?.pe?.last_price ?? 0,
                ceOI: oc[strike]?.ce?.oi ?? 0,
                peOI: oc[strike]?.pe?.oi ?? 0,
                ceVol: oc[strike]?.ce?.volume,
                peVol: oc[strike]?.pe?.volume,
                ceIV: oc[strike]?.ce?.implied_volatility,
                peIV: oc[strike]?.pe?.implied_volatility,
              }));
          const list = parsed.sort((a, b) => a.strike - b.strike);
          setRows(list);
          setUpdatedAt(Date.now());
          if (!quiet && !list.length)
            setErr("No strikes for this expiry — try another expiry");
          if (j.expiry && j.expiry !== expiry) setExpiry(j.expiry);
        }
      } catch {
        if (!stop && !quiet) {
          setRows([]);
          setErr("Chain unavailable — feed offline");
        }
      } finally {
        if (!stop && !quiet) setLoading(false);
      }
    }
    load();
    // Quiet refresh on the shared-board TTL so CE/PE LTPs stay live.
    const id = setInterval(() => load(true), 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.underlying, expiry]);

  const atm = useMemo(
    () =>
      rows.length
        ? rows.reduce((a, b) =>
            Math.abs(b.strike - props.ltp) < Math.abs(a.strike - props.ltp)
              ? b
              : a,
          ).strike
        : 0,
    [rows, props.ltp],
  );

  useEffect(() => {
    props.onStats(rows, atm, expiry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, atm, expiry]);

  const maxOI = Math.max(
    1,
    ...rows.map((r) => Math.max(r.ceOI || 0, r.peOI || 0)),
  );
  const shown = useMemo(() => {
    let list = [...rows];
    if (atmOnly && atm)
      list = list.filter(
        (r) => Math.abs(r.strike - atm) <= (props.ltp > 5000 ? 250 : 50),
      );
    if (money !== "ALL" && props.ltp > 0)
      // CE-perspective: strikes below spot are call-ITM, above are call-OTM
      // (mirror image for puts — tooltips on the buttons say so).
      list = list.filter((r) =>
        money === "ITM" ? r.strike < props.ltp : r.strike > props.ltp,
      );
    if (q.trim()) {
      const n = Number(q.trim());
      if (Number.isFinite(n))
        list = list.filter(
          (r) => Math.abs(r.strike - n) < (props.ltp > 5000 ? 100 : 20),
        );
    }
    if (sort === "CE_OI") list.sort((a, b) => (b.ceOI || 0) - (a.ceOI || 0));
    else if (sort === "PE_OI")
      list.sort((a, b) => (b.peOI || 0) - (a.peOI || 0));
    else list.sort((a, b) => a.strike - b.strike);
    return list;
  }, [rows, atmOnly, atm, q, props.ltp, money, sort]);

  const pick = (
    strike: number,
    side: "CE" | "PE",
    action: "BUY" | "SELL",
    price: number,
  ) => {
    if (!Number.isFinite(price) || price <= 0) return;
    props.onAddLeg({ strike, side, action, price, lots: 1 });
  };

  return (
    <div className="broker-card broker-card-hover overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-border space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="eyebrow">Option chain</div>
            <div className="display-num text-sm font-semibold mt-0.5">
              {props.underlying} @ ₹
              {props.ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              {loading && (
                <span className="ml-2 text-[11px] font-mono text-foreground/45">
                  · loading…
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="FIND STRIKE"
              inputMode="numeric"
              aria-label="Find strike"
              className="h-[30px] w-28 border border-border bg-card px-2 text-[11px] font-mono focus:outline-none focus-visible:brand-ring"
            />
            <button
              onClick={() => setAtmOnly((v) => !v)}
              aria-pressed={atmOnly}
              className={`pressable h-[30px] rounded-md border px-3 text-[11px] font-semibold transition-colors ${atmOnly ? "border-transparent bg-foreground text-background" : "border-border bg-card text-foreground/70 hover:bg-muted"}`}
            >
              ATM ±
            </button>
            {(["ALL", "ITM", "OTM"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMoney(m)}
                aria-pressed={money === m}
                title={
                  m === "ALL"
                    ? "Show all strikes"
                    : m === "ITM"
                      ? "Call-ITM: strikes below spot"
                      : "Call-OTM: strikes above spot"
                }
                className={`pressable h-[30px] px-2.5 text-[11px] font-mono border ${money === m ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}
              >
                {m}
              </button>
            ))}
            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as "STRIKE" | "CE_OI" | "PE_OI")
              }
              aria-label="Sort strikes"
              className="h-[30px] border border-border bg-card px-2 text-[11px] font-mono"
            >
              <option value="STRIKE">STRIKE ↑</option>
              <option value="CE_OI">CE OI ↓</option>
              <option value="PE_OI">PE OI ↓</option>
            </select>
          </div>
        </div>
        <div
          className="flex gap-1.5 overflow-x-auto pb-0.5"
          role="tablist"
          aria-label="Expiries"
        >
          {expiries.length === 0 && (
            <span className="text-[11px] font-mono text-foreground/40">
              {err ? "no expiries — offline" : "loading expiries…"}
            </span>
          )}
          {expiries.map((e) => (
            <button
              key={e}
              role="tab"
              aria-selected={expiry === e}
              onClick={() => setExpiry(e)}
              className={`pressable shrink-0 h-[28px] px-3 text-[11px] font-mono border ${expiry === e ? "bg-foreground text-background border-foreground" : "border-border bg-card hover:bg-muted"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      {err && (
        <div className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground sm:px-5">
          {err}
        </div>
      )}
      {loading ? (
        <div className="divide-y divide-border" aria-label="Loading chain">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 sm:px-5 py-2.5"
            >
              <span className="skeleton inline-block h-4 w-16" />
              <span className="skeleton inline-block h-4 w-20" />
              <span className="skeleton inline-block h-4 w-12" />
              <span className="skeleton inline-block h-4 w-20" />
              <span className="skeleton inline-block h-4 w-16" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No strikes match"
            hint="Clear the strike filter or toggle ATM ±"
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <caption className="sr-only">
                Calls on the left, puts on the right
              </caption>
              <thead className="sticky top-0 bg-muted">
                <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-right font-medium">CE OI</th>
                  <th className="px-3 py-2 text-right font-medium">CE Vol</th>
                  <th className="px-3 py-2 text-right font-medium">CE LTP</th>
                  <th className="px-3 py-2 text-center font-medium">Strike</th>
                  <th className="px-3 py-2 text-right font-medium">PE LTP</th>
                  <th className="px-3 py-2 text-right font-medium">PE Vol</th>
                  <th className="px-3 py-2 text-right font-medium">PE OI</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isAtm = r.strike === atm;
                  const itmCe = r.strike < props.ltp;
                  const itmPe = r.strike > props.ltp;
                  return (
                    <tr
                      key={r.strike}
                      className={`row-slide border-b border-border last:border-0 ${isAtm ? "bg-muted/70" : ""}`}
                    >
                      <td className="relative px-3 py-2 text-right display-num text-xs">
                        <span
                          className="absolute inset-y-1 left-1 bg-positive/10"
                          style={{
                            width: `${Math.min(96, ((r.ceOI || 0) / maxOI) * 96)}%`,
                          }}
                        />
                        <span className="relative">{fmtOI(r.ceOI || 0)}</span>
                        {r.ceIV != null && (
                          <span className="relative ml-1 text-[10px] text-foreground/40">
                            IV {Number(r.ceIV).toFixed(0)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right display-num text-xs text-foreground/55">
                        {r.ceVol != null ? fmtOI(r.ceVol) : "—"}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right ${itmCe ? "bg-positive/[0.06]" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => pick(r.strike, "CE", "BUY", r.ceLtp)}
                            disabled={!Number.isFinite(r.ceLtp) || r.ceLtp <= 0}
                            title={`Buy ${r.strike}CE @ ₹${Number(r.ceLtp || 0).toFixed(2)}`}
                            className="pressable display-num h-[44px] sm:h-[28px] px-2.5 rounded-md bg-positive/15 border border-positive/40 text-positive text-xs font-bold hover:bg-positive hover:text-positive-foreground transition-colors disabled:opacity-40"
                          >
                            B ₹{Number(r.ceLtp || 0).toFixed(2)}
                          </button>
                          <button
                            onClick={() =>
                              pick(r.strike, "CE", "SELL", r.ceLtp)
                            }
                            disabled={!Number.isFinite(r.ceLtp) || r.ceLtp <= 0}
                            title={`Sell ${r.strike}CE @ ₹${Number(r.ceLtp || 0).toFixed(2)}`}
                            className="pressable h-[44px] sm:h-[28px] px-2 rounded-md border border-negative/40 bg-card text-negative/90 text-[11px] font-mono font-bold hover:bg-negative hover:text-negative-foreground transition-colors disabled:opacity-40"
                          >
                            S
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`display-num text-[13px] font-bold ${isAtm ? "text-brand" : ""}`}
                        >
                          {r.strike}
                          {isAtm && (
                            <span className="ml-1 broker-pill bg-brand/15 text-brand px-1.5 py-px text-[9px] font-mono">
                              ATM
                            </span>
                          )}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right ${itmPe ? "bg-negative/[0.06]" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() =>
                              pick(r.strike, "PE", "SELL", r.peLtp)
                            }
                            disabled={!Number.isFinite(r.peLtp) || r.peLtp <= 0}
                            title={`Sell ${r.strike}PE @ ₹${Number(r.peLtp || 0).toFixed(2)}`}
                            className="pressable h-[44px] sm:h-[28px] px-2 rounded-md border border-negative/40 bg-card text-negative/90 text-[11px] font-mono font-bold hover:bg-negative hover:text-negative-foreground transition-colors disabled:opacity-40"
                          >
                            S
                          </button>
                          <button
                            onClick={() => pick(r.strike, "PE", "BUY", r.peLtp)}
                            disabled={!Number.isFinite(r.peLtp) || r.peLtp <= 0}
                            title={`Buy ${r.strike}PE @ ₹${Number(r.peLtp || 0).toFixed(2)}`}
                            className="pressable display-num h-[44px] sm:h-[28px] px-2.5 rounded-md bg-negative/15 border border-negative/40 text-negative text-xs font-bold hover:bg-negative hover:text-negative-foreground transition-colors disabled:opacity-40"
                          >
                            B ₹{Number(r.peLtp || 0).toFixed(2)}
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right display-num text-xs text-foreground/55">
                        {r.peVol != null ? fmtOI(r.peVol) : "—"}
                      </td>
                      <td className="relative px-3 py-2 text-right display-num text-xs">
                        <span
                          className="absolute inset-y-1 right-1 bg-negative/10"
                          style={{
                            width: `${Math.min(96, ((r.peOI || 0) / maxOI) * 96)}%`,
                          }}
                        />
                        <span className="relative">{fmtOI(r.peOI || 0)}</span>
                        {r.peIV != null && (
                          <span className="relative ml-1 text-[10px] text-foreground/40">
                            IV {Number(r.peIV).toFixed(0)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div
            className="sm:hidden divide-y divide-border"
            role="list"
            aria-label="Strikes"
          >
            {shown.slice(0, 60).map((r) => {
              const isAtm = r.strike === atm;
              const ceOk = Number.isFinite(r.ceLtp) && r.ceLtp > 0;
              const peOk = Number.isFinite(r.peLtp) && r.peLtp > 0;
              return (
                <div
                  key={r.strike}
                  role="listitem"
                  className={`px-4 py-2.5 ${isAtm ? "bg-muted/70" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`display-num text-sm font-bold ${isAtm ? "text-brand" : ""}`}
                    >
                      {r.strike}
                      {isAtm && (
                        <span className="ml-1 broker-pill bg-brand/15 text-brand px-1.5 py-px text-[9px] font-mono">
                          ATM
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono text-foreground/40">
                      CE OI {fmtOI(r.ceOI || 0)} · PE OI {fmtOI(r.peOI || 0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => pick(r.strike, "CE", "BUY", r.ceLtp)}
                        disabled={!ceOk}
                        aria-label={`Buy ${r.strike}CE`}
                        className="pressable flex-1 h-[44px] rounded-md bg-positive/15 border border-positive/40 text-positive text-xs font-bold display-num disabled:opacity-40"
                      >
                        CE B ₹{Number(r.ceLtp || 0).toFixed(2)}
                      </button>
                      <button
                        onClick={() => pick(r.strike, "CE", "SELL", r.ceLtp)}
                        disabled={!ceOk}
                        aria-label={`Sell ${r.strike}CE`}
                        className="pressable h-[44px] w-[44px] rounded-md border border-negative/40 text-negative font-mono font-bold disabled:opacity-40"
                      >
                        S
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => pick(r.strike, "PE", "BUY", r.peLtp)}
                        disabled={!peOk}
                        aria-label={`Buy ${r.strike}PE`}
                        className="pressable flex-1 h-[44px] rounded-md bg-negative/15 border border-negative/40 text-negative text-xs font-bold display-num disabled:opacity-40"
                      >
                        PE B ₹{Number(r.peLtp || 0).toFixed(2)}
                      </button>
                      <button
                        onClick={() => pick(r.strike, "PE", "SELL", r.peLtp)}
                        disabled={!peOk}
                        aria-label={`Sell ${r.strike}PE`}
                        className="pressable h-[44px] w-[44px] rounded-md border border-negative/40 text-negative font-mono font-bold disabled:opacity-40"
                      >
                        S
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 sm:px-5 py-2 border-t border-border flex flex-wrap justify-between gap-2 text-[10px] font-mono text-foreground/40">
            <span>
              <span className="inline-block px-1.5 py-px rounded bg-positive/15 border border-positive/40 text-positive font-bold mr-1">
                B ₹x
              </span>
              = BUY ticket ·
              <span className="inline-block px-1.5 py-px rounded border border-negative/40 text-negative/90 font-bold mx-1">
                S
              </span>
              = SELL ticket · tap to trade →
            </span>
            <span>
              {shown.length} strikes
              {updatedAt
                ? ` · updated ${new Date(updatedAt).toLocaleTimeString("en-IN", { hour12: false })}`
                : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
