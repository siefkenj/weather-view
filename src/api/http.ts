// The single network chokepoint. Every JSON API call in the app goes through
// fetchJson, which:
//   • sandwiches the request in begin/succeed/fail on the status store, so
//     <StatusBar> can show what's loading and surface a 429 "too many requests"
//     against the specific query that hit it;
//   • optionally serves/saves a localStorage cache (see httpCache) — a fresh hit
//     (same clock hour, or within a fixed maxAge for live data) skips the network
//     entirely, and a stale entry is used as a fallback when a fetch is rate-limited
//     or fails, so data keeps showing.
//
// One wrapper means new endpoints get status + caching for free, and the 429
// reporting covers the RTK Query endpoints and the direct grid/radar fetches alike.

import { beginRequest, cancelRequest, failRequest, succeedRequest } from "../status/statusStore";
import { readCache, writeCache, type CacheFreshness } from "./httpCache";

export class HttpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Cache policy for a request:
 *   - `false` / omitted — no localStorage cache.
 *   - `true` — cache with clock-hour freshness (the large, low-priority map grids and
 *     other hourly-rolling data).
 *   - `{ maxAgeMs }` — cache with a fixed, short freshness window, for live point data
 *     that must revalidate on its poll / tab-refocus. Still written through and used as
 *     an offline/rate-limit fallback — just not served fresh for long.
 */
export type CachePolicy = boolean | { maxAgeMs: number };

export interface FetchOptions {
  /** Human-readable name of the request, shown in the status bar (e.g. "forecast"). */
  label: string;
  signal?: AbortSignal;
  cache?: CachePolicy;
}

/** Map a request's cache policy to a freshness rule (null = don't cache at all). */
const freshnessOf = (cache: CachePolicy | undefined): CacheFreshness | null =>
  !cache ? null : cache === true ? "hour" : { maxAgeMs: cache.maxAgeMs };

const isAbort = (err: unknown, signal?: AbortSignal): boolean =>
  !!signal?.aborted || (err instanceof DOMException && err.name === "AbortError");

/** Parse an Open-Meteo-style error body for a friendlier reason, else the status text. */
async function reasonFrom(res: Response): Promise<string> {
  const base = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { reason?: string };
    if (body && typeof body.reason === "string" && body.reason) return body.reason;
  } catch {
    // not JSON — fall back to the status line
  }
  return base || `HTTP ${res.status}`;
}

export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<T> {
  const { label, signal, cache } = opts;
  const freshness = freshnessOf(cache);

  // A still-fresh cache hit is served without touching the network.
  if (freshness) {
    const hit = readCache<T>(url, freshness);
    if (hit && hit.fresh) return hit.body;
  }

  const id = beginRequest(label);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new HttpError(`${label} request failed: ${await reasonFrom(res)}`, res.status);
    const body = (await res.json()) as T;
    succeedRequest(id);
    if (freshness) writeCache(url, body);
    return body;
  } catch (err) {
    if (isAbort(err, signal)) {
      cancelRequest(id); // superseded request — not a user-facing failure
      throw err;
    }
    const status = err instanceof HttpError ? err.status : undefined;
    const message = err instanceof Error ? err.message : String(err);
    failRequest(id, { label, status, message });
    // Rate-limited or offline but a still-valid (within the hard TTL) copy exists?
    // Serve it so the user keeps seeing data; the status bar explains it's stale.
    if (freshness) {
      const hit = readCache<T>(url, freshness);
      if (hit) return hit.body;
    }
    throw err;
  }
}
