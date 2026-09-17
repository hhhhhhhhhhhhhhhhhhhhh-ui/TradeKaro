type Entry = { data: any; ts: number; hits: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<any>>();

export const TTL = {
  QUOTE_MS: 5000,
  CHAIN_MS: 5000,
  FULLQUOTE_MS: 5000,
  CANDLES_MS: 60_000,
  EXPIRIES_MS: 12 * 3600_000,
};

export const cacheStats = { hits: 0, misses: 0, upstoxCalls: 0 };

// Shared fetch. Fresh cache wins; concurrent callers share a single upstream
// call; and a stale entry is served immediately while it refreshes in the
// background (stale-while-revalidate). That last part is what makes prices and
// charts feel instant: only the very first request for a key waits on the
// network, everything after it paints from cache and updates a beat later.
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { swr?: boolean } = {},
): Promise<{ data: T; cached: boolean }> {
  const swr = opts.swr !== false;
  const hit = store.get(key);
  const age = hit ? Date.now() - hit.ts : Infinity;

  // Fresh enough — no upstream call at all.
  if (hit && age < ttlMs) {
    hit.hits += 1;
    cacheStats.hits += 1;
    return { data: hit.data as T, cached: true };
  }

  const ongoing = inflight.get(key);

  // Stale but usable: hand back the last known value and refresh behind the
  // scenes, so the caller never blocks on the provider.
  if (swr && hit) {
    cacheStats.hits += 1;
    if (!ongoing) void refresh(key, fetcher);
    return { data: hit.data as T, cached: true };
  }

  // Cold key with a request already in flight — piggyback on it.
  if (ongoing) {
    cacheStats.hits += 1;
    return { data: (await ongoing) as T, cached: true };
  }

  cacheStats.misses += 1;
  cacheStats.upstoxCalls += 1;
  const p = (async () => {
    const data = await fetcher();
    store.set(key, { data, ts: Date.now(), hits: 0 });
    return data;
  })();
  inflight.set(key, p);
  try {
    return { data: (await p) as T, cached: false };
  } finally {
    inflight.delete(key);
  }
}

// Background revalidation. Failures are swallowed and the timestamp is still
// advanced, so a dead provider costs one attempt per TTL instead of a storm.
function refresh<T>(key: string, fetcher: () => Promise<T>) {
  cacheStats.upstoxCalls += 1;
  const p = (async () => {
    try {
      const data = await fetcher();
      store.set(key, { data, ts: Date.now(), hits: 0 });
      return data;
    } catch {
      const prev = store.get(key);
      if (prev) prev.ts = Date.now();
      return prev?.data as T;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function cacheInfo() {
  return {
    ...cacheStats,
    keys: store.size,
    now: Date.now(),
  };
}
