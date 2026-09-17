"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { symbols } from "./symbols";
import { FiSearch, FiPlus, FiTrendingUp, FiArrowRight } from "react-icons/fi";

// ── Unified instrument search ───────────────────────────────────────────────
//
// One box that finds three kinds of thing, the way a broker's search does:
//
//   1. a stock          -> /stocks/SYMBOL
//   2. an option chain  -> /options?underlying=SYMBOL
//   3. one contract     -> /options?underlying=SYMBOL&strike=N&side=CE
//
// (3) is reached by typing a strike, optionally with the side: "NIFTY 23400",
// "NIFTY 23400 PE", or just "nifty 23400ce". Everything is matched against the
// local instrument master, so results are instant with no request per keystroke.

const INDICES = [
  { sym: "NIFTY", name: "Nifty 50" },
  { sym: "BANKNIFTY", name: "Nifty Bank" },
  { sym: "FINNIFTY", name: "Nifty Financial Services" },
  { sym: "SENSEX", name: "BSE Sensex" },
  { sym: "BANKEX", name: "BSE Bankex" },
  { sym: "NIFTYNXT50", name: "Nifty Next 50" },
];

// Symbols the platform genuinely trades — they are mapped to Upstox instrument
// keys in `app/lib/upstox.ts` and quoted all over the UI (ticker tape, movers,
// watchlist rail) — but which are missing from the NSE master above. Tata Motors
// is the notable one: the master lists it as `TMCV`, while the rest of the app
// (and the live feed) knows it as `TATAMOTORS`. Searching either must work, so
// these are merged into the index and the master always wins on a clash.
const EXTRA_SYMBOLS: { Scrip: string; "Company Name": string }[] = [
  { Scrip: "TATAMOTORS", "Company Name": "TATA MOTORS LIMITED" },
];

const ALL_SYMBOLS = (() => {
  const known = new Set(symbols.map((s) => s.Scrip));
  return [...symbols, ...EXTRA_SYMBOLS.filter((s) => !known.has(s.Scrip))];
})();

export type SearchHit =
  | { kind: "stock"; symbol: string; name: string }
  | { kind: "chain"; symbol: string; name: string }
  | {
      kind: "contract";
      underlying: string;
      strike: number;
      side: "CE" | "PE";
      name: string;
    };

type StockHit = { kind: "stock"; symbol: string; name: string };
type ChainHit = { kind: "chain"; symbol: string; name: string };
type ContractHit = {
  kind: "contract";
  underlying: string;
  strike: number;
  side: "CE" | "PE";
  name: string;
};

export function hrefFor(hit: SearchHit): string {
  if (hit.kind === "stock") return `/stocks/${encodeURIComponent(hit.symbol)}`;
  if (hit.kind === "chain")
    return `/options?underlying=${encodeURIComponent(hit.symbol)}`;
  return `/options?underlying=${encodeURIComponent(hit.underlying)}&strike=${hit.strike}&side=${hit.side}`;
}

// "NIFTY 23400 PE" / "nifty23400ce" / "BANKNIFTY 51500" -> underlying + strike + side
// `side` is null when the user did not name one, so both legs get offered.
function parseContract(q: string): {
  underlying: string;
  strike: number;
  side: "CE" | "PE" | null;
} | null {
  const s = q.trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([A-Z&]+)\s*(\d+(?:\.\d+)?)\s*(CE|PE)?$/);
  if (!m) return null;
  const underlying = m[1];
  const strike = Number(m[2]);
  if (!underlying || !Number.isFinite(strike) || strike <= 0) return null;
  return {
    underlying,
    strike,
    side: m[3] === "PE" ? "PE" : m[3] === "CE" ? "CE" : null,
  };
}

export default function SymbolSearch({
  onAdd,
  onPick,
  placeholder = "Search stocks & options — e.g. RELIANCE, NIFTY 23400 CE",
  autoFocus = false,
  className = "",
}: {
  /** When given, every stock result gets an ADD button. */
  onAdd?: (symbol: string) => void;
  /** Override navigation entirely. */
  onPick?: (hit: SearchHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { stocks, chains, contracts } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 1) return { stocks: [], chains: [], contracts: [] };

    // Contract syntax wins: it is the most specific thing the user can type.
    const parsed = parseContract(q);
    const contracts: ContractHit[] = parsed
      ? (["CE", "PE"] as const)
          .filter((s) => !parsed.side || parsed.side === s)
          .map((side) => ({
            kind: "contract" as const,
            underlying: parsed.underlying,
            strike: parsed.strike,
            side,
            name: `${parsed.underlying} ${parsed.strike} ${side}`,
          }))
      : [];

    const matches = (sym: string, name: string) =>
      sym.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);

    const chains: ChainHit[] = INDICES.filter((i) =>
      matches(i.sym, i.name),
    ).map((i) => ({
      kind: "chain" as const,
      symbol: i.sym,
      name: i.name,
    }));

    // Rank exact symbol, then symbol prefix, then company-name matches.
    const scored: { score: number; hit: StockHit }[] = [];
    for (const s of ALL_SYMBOLS) {
      const sym = s.Scrip;
      const name = s["Company Name"] || "";
      const symL = sym.toLowerCase();
      const nameL = name.toLowerCase();
      let score = -1;
      if (symL === needle) score = 0;
      else if (symL.startsWith(needle)) score = 1;
      else if (nameL.startsWith(needle)) score = 2;
      else if (symL.includes(needle)) score = 3;
      else if (nameL.includes(needle)) score = 4;
      if (score >= 0)
        scored.push({ score, hit: { kind: "stock", symbol: sym, name } });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        a.hit.symbol.length - b.hit.symbol.length ||
        a.hit.symbol.localeCompare(b.hit.symbol),
    );
    return {
      stocks: scored.slice(0, 8).map((s) => s.hit) as StockHit[],
      chains,
      contracts,
    };
  }, [q]);

  // Flat list in render order — keyboard nav walks this.
  const hits: SearchHit[] = [...stocks, ...contracts, ...chains];

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    if (onPick) onPick(hit);
    else router.push(hrefFor(hit));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    }
  }

  const show = open && q.trim().length > 0;
  const nothing = show && hits.length === 0;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="flex h-11 items-center gap-2.5 rounded-md border border-border bg-card px-3 transition-colors focus-within:border-foreground">
        <FiSearch
          size={15}
          aria-hidden
          className="shrink-0 text-muted-foreground"
        />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search stocks and options"
          className="w-full bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {q ? (
          <button
            onClick={() => {
              setQ("");
              setOpen(false);
            }}
            aria-label="Clear search"
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
          >
            ESC
          </button>
        ) : null}
      </div>

      {show ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[62vh] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
          {nothing ? (
            <div className="px-4 py-6 text-center">
              <div className="font-mono text-[12px] text-muted-foreground">
                No match for “{q.trim().toUpperCase()}”
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground/70">
                Try a symbol, a company name, or “NIFTY 23400 CE”.
              </div>
            </div>
          ) : null}

          {contracts.length > 0 ? <Group label="Options" /> : null}
          {contracts.map((h) => (
            <Row
              key={`${h.underlying}-${h.strike}-${h.side}`}
              active={hits[active] === h}
              icon={<FiTrendingUp size={14} aria-hidden />}
              title={h.name}
              sub="Open contract in the options desk"
              onClick={() => go(h)}
            />
          ))}

          {stocks.length > 0 ? <Group label="Stocks" /> : null}
          {stocks.map((h) => (
            <Row
              key={h.symbol}
              active={hits[active] === h}
              icon={
                <span className="font-mono text-[10px] font-bold">
                  {h.symbol.slice(0, 2)}
                </span>
              }
              title={h.symbol}
              sub={h.name}
              onClick={() => go(h)}
              action={
                onAdd ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(h.symbol);
                      setQ("");
                      setOpen(false);
                    }}
                    aria-label={`Add ${h.symbol} to watchlist`}
                    className="flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10.5px] font-semibold text-foreground/80 transition-colors hover:bg-muted"
                  >
                    <FiPlus size={11} aria-hidden />
                    ADD
                  </button>
                ) : null
              }
            />
          ))}

          {chains.length > 0 ? <Group label="Option chains" /> : null}
          {chains.map((h) => (
            <Row
              key={h.symbol}
              active={hits[active] === h}
              icon={<FiTrendingUp size={14} aria-hidden />}
              title={`${h.symbol} options`}
              sub={h.name}
              onClick={() => go(h)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <div className="sticky top-0 border-b border-border bg-muted/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
      {label}
    </div>
  );
}

function Row({
  active,
  icon,
  title,
  sub,
  onClick,
  action,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${active ? "bg-muted" : "hover:bg-muted/50"}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/60 bg-muted/50 text-foreground/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {sub ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
      {action ?? (
        <FiArrowRight
          size={13}
          aria-hidden
          className="shrink-0 text-muted-foreground/50"
        />
      )}
    </div>
  );
}
