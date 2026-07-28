// The single network chokepoint. Every JSON API call in the app goes through
// fetchJson, which:
//   • sandwiches the request in begin/succeed/fail on the status store, so
//     <StatusBar> can show what's loading and surface a 429 "too many requests"
//     against the specific query that hit it;
//   • optionally serves/saves a localStorage cache (see httpCache) — a same-hour
//     hit skips the network entirely, and a stale entry is used as a fallback when
//     a fetch is rate-limited or fails, so data keeps showing.
//
// One wrapper means new endpoints get status + caching for free, and the 429
// reporting covers the RTK Query endpoints and the direct grid/radar fetches alike.

import { beginRequest, cancelRequest, failRequest, succeedRequest } from "../status/statusStore";
import { readCache, writeCache } from "./httpCache";

export class HttpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface FetchOptions {
  /** Human-readable name of the request, shown in the status bar (e.g. "forecast"). */
  label: string;
  signal?: AbortSignal;
  /** Persist the response to (and serve it from) the localStorage cache. */
  cache?: boolean;
}

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

  // A same-clock-hour cache hit is served without touching the network.
  if (cache) {
    const hit = readCache<T>(url);
    if (hit && hit.fresh) return hit.body;
  }

  const id = beginRequest(label);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new HttpError(`${label} request failed: ${await reasonFrom(res)}`, res.status);
    const body = (await res.json()) as T;
    succeedRequest(id);
    if (cache) writeCache(url, body);
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
    if (cache) {
      const hit = readCache<T>(url);
      if (hit) return hit.body;
    }
    throw err;
  }
}
