// localStorage-backed response cache for the JSON APIs, with two independent bounds:
//
//   • FRESHNESS — how long an entry is served *without a refetch*. Two modes (per read):
//       - "hour" (default): only within the clock hour it was fetched. Open-Meteo's
//         forecast / air-quality / wind windows are relative to "now" and roll hourly
//         (the hours that were forecast become observations), so once the hour changes
//         we refetch and pick up the accurate historical data. Used by the large,
//         low-priority map grids.
//       - { maxAgeMs }: a fixed, short age. The live point queries (forecast / minutely
//         / air-quality panel) use this so their 10-minute poll and tab-refocus refetch
//         actually revalidate over the network instead of being absorbed by the cache.
//
//   • HARD EXPIRY after ~2 days — older entries are dropped entirely. Until then a
//     non-fresh entry is still handed back as a *stale fallback* (see http.ts) when the
//     network is unavailable or rate-limited, so the user keeps seeing something.
//
// A manual reset (Settings → Clear cached data) wipes the whole namespace. All access
// is best-effort: any storage error (private mode, quota) degrades to "no cache".

const PREFIX = "wv:cache:v1:";
const HARD_TTL_MS = 2 * 24 * 60 * 60 * 1000; // ~2 days
const MAX_ENTRIES = 60; // rough bound so grid pans/zooms can't fill the quota
/** Byte bound, enforced alongside MAX_ENTRIES. A count-only bound is no defence against a
 *  few very large entries: the optimizer's 90-day history downloads run to hundreds of KB
 *  each, so a handful can exhaust the origin quota while sitting far under MAX_ENTRIES.
 *  Nothing would then be evicted, the retry in `writeCache` would fail, and every later
 *  write — forecast, air quality, radar — would fail silently, taking the stale-fallback
 *  that http.ts leans on when rate-limited or offline down with it. */
const MAX_BYTES = 3 * 1024 * 1024; // ~3 MB of a typical 5 MB origin quota

interface Entry<T> {
  /** Fetched-at, ms epoch. */
  at: number;
  /** Clock-hour bucket at fetch time (Math.floor(at / 1h)). */
  hour: number;
  body: T;
}

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // access itself can throw under strict privacy settings
  }
}

const hourBucket = (ms: number): number => Math.floor(ms / 3_600_000);

/** Collect the keys in our namespace (snapshotting first, so callers can remove safely). */
function namespaceKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** An entry's fetched-at stamp and its approximate footprint, in one read. */
function entryMeta(s: Storage, key: string): { at: number; bytes: number } {
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return { at: 0, bytes: 0 };
  }
  const bytes = key.length + (raw?.length ?? 0);
  try {
    return { at: (JSON.parse(raw ?? "{}") as Entry<unknown>).at ?? 0, bytes };
  } catch {
    return { at: 0, bytes };
  }
}

export interface CacheHit<T> {
  body: T;
  /** Within the freshness window → safe to serve without a refetch. */
  fresh: boolean;
}

/** How long a cached entry counts as fresh: within the same clock hour ("hour", the
 *  default), or within a fixed age ({ maxAgeMs }) for data that must revalidate sooner. */
export type CacheFreshness = "hour" | { maxAgeMs: number };

/** Look up a URL. Returns the entry (with a freshness flag) if present and within the
 *  hard TTL, else null. A non-fresh hit is still returned — as a stale fallback. */
export function readCache<T>(url: string, freshness: CacheFreshness = "hour"): CacheHit<T> | null {
  const s = store();
  if (!s) return null;
  const key = PREFIX + url;
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let entry: Entry<T> | null;
  try {
    entry = JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
  const now = Date.now();
  if (!entry || typeof entry.at !== "number" || now - entry.at > HARD_TTL_MS) {
    try {
      s.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  const fresh =
    freshness === "hour" ? entry.hour === hourBucket(now) : now - entry.at <= freshness.maxAgeMs;
  return { body: entry.body, fresh };
}

/** Store a response, pruning expired (and, on quota failure, oldest) entries. */
export function writeCache<T>(url: string, body: T): void {
  const s = store();
  if (!s) return;
  const now = Date.now();
  const payload = JSON.stringify({ at: now, hour: hourBucket(now), body } satisfies Entry<T>);
  try {
    s.setItem(PREFIX + url, payload);
  } catch {
    pruneCache(true); // quota exceeded — evict aggressively and retry once
    try {
      s.setItem(PREFIX + url, payload);
    } catch {
      /* give up — caching is best-effort */
    }
  }
}

/** Drop hard-expired entries; if `aggressive`, also evict oldest-first until the survivors
 *  are within BOTH bounds (MAX_ENTRIES and MAX_BYTES). */
export function pruneCache(aggressive: boolean): void {
  const s = store();
  if (!s) return;
  const now = Date.now();
  const live: { key: string; at: number; bytes: number }[] = [];
  for (const key of namespaceKeys(s)) {
    const { at, bytes } = entryMeta(s, key);
    if (at === 0 || now - at > HARD_TTL_MS) {
      try {
        s.removeItem(key);
      } catch {
        /* ignore */
      }
    } else {
      live.push({ key, at, bytes });
    }
  }
  if (!aggressive) return;
  live.sort((a, b) => a.at - b.at); // oldest first
  let count = live.length;
  let bytes = live.reduce((sum, e) => sum + e.bytes, 0);
  for (const e of live) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    try {
      s.removeItem(e.key);
    } catch {
      /* ignore */
    }
    count--;
    bytes -= e.bytes;
  }
}

export interface CacheStats {
  count: number;
  bytes: number;
}

/** Count + approximate byte size of the cached entries (for the settings panel). */
export function cacheStats(): CacheStats {
  const s = store();
  if (!s) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const key of namespaceKeys(s)) {
    count++;
    bytes += key.length + (s.getItem(key)?.length ?? 0);
  }
  return { count, bytes };
}

/** Wipe the whole cache namespace. Returns how many entries were removed. */
export function clearCache(): number {
  const s = store();
  if (!s) return 0;
  const keys = namespaceKeys(s);
  for (const key of keys) {
    try {
      s.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  return keys.length;
}
