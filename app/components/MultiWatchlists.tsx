"use client";
import { useEffect, useState } from "react";
import { getWLs, saveWLs } from "@/app/lib/watchlists";
import { sileo } from "sileo";

// Local multi-watchlists layered over the backend single list.
export default function MultiWatchlists() {
  const [lists, setLists] = useState(() =>
    typeof window === "undefined" ? [] : getWLs(),
  );
  const [active, setActive] = useState(0);
  const [sym, setSym] = useState("");
  useEffect(() => {
    saveWLs(lists);
  }, [lists]);

  function addList() {
    setLists([
      ...lists,
      { name: `List ${lists.length + 1}`, symbols: [], notes: {} },
    ]);
    setActive(lists.length);
  }
  function addSym() {
    if (!sym) return;
    const next = lists.map((l, i) =>
      i === active
        ? { ...l, symbols: [...new Set([...l.symbols, sym.toUpperCase()])] }
        : l,
    );
    setLists(next);
    setSym("");
    sileo.success({ title: `Added ${sym.toUpperCase()}` });
  }
  const cur = lists[active];
  if (!cur) return null;
  return (
    <div className="border border-border bg-card p-6">
      <div className="flex flex-wrap gap-2 mb-4">
        {lists.map((l, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={`px-4 py-1.5 text-xs font-mono border ${i === active ? "bg-foreground text-background" : "border-border hover:bg-muted"}`}
          >
            {l.name} ({l.symbols.length})
          </button>
        ))}
        <button
          onClick={addList}
          className="px-4 py-1.5 text-xs font-mono border border-dashed border-border"
        >
          + NEW
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        <input
          value={sym}
          onChange={(e) => setSym(e.target.value.toUpperCase())}
          placeholder="ADD SYMBOL"
          className="flex-1 border border-border px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={addSym}
          className="text-xs font-mono bg-foreground text-background px-5"
        >
          ADD
        </button>
      </div>
      {cur.symbols.map((s) => (
        <div key={s} className="border-b border-border last:border-0 py-2">
          <div className="flex justify-between text-sm font-mono">
            <a href={`/stocks/${s}`} className="font-semibold hover:underline">
              {s}
            </a>
            <button
              onClick={() =>
                setLists(
                  lists.map((l, i) =>
                    i === active
                      ? { ...l, symbols: l.symbols.filter((x) => x !== s) }
                      : l,
                  ),
                )
              }
              className="text-xs underline"
            >
              REMOVE
            </button>
          </div>
          <input
            value={cur.notes[s] || ""}
            onChange={(e) =>
              setLists(
                lists.map((l, i) =>
                  i === active
                    ? { ...l, notes: { ...l.notes, [s]: e.target.value } }
                    : l,
                ),
              )
            }
            placeholder="Note..."
            className="mt-1 w-full text-xs font-mono bg-transparent border-b border-border/50 focus:outline-none"
          />
        </div>
      ))}
      {cur.symbols.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Empty — add symbols above.
        </p>
      ) : null}
    </div>
  );
}
