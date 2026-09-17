import { getSettings, type AdminSettings } from "./adminStore";

let cache: { at: number; s: AdminSettings } | null = null;
const CACHE_MS = 5000;

export async function runtimeSettings(): Promise<AdminSettings> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.s;
  const s = await getSettings();
  cache = { at: now, s };
  return s;
}

export function bustRuntimeCache() {
  cache = null;
}
