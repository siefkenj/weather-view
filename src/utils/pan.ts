// Pure math for panning the meteogram window along its `view_start_datetime`.
// Dragging moves the start continuously (any value); the arrows quantise it to a
// day boundary, always advancing at least 12.5 h so a press makes a real jump even
// from a fractional drag position (and lands on midnight to keep day labels aligned).

import { addDays, parseLocal } from "./format";

const DAY_MS = 86_400_000;
const MIN_ADVANCE_MS = 12.5 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

function localKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local ISO minute string ("YYYY-MM-DDTHH:mm") for a wall-clock timestamp. */
function toIso(ms: number): string {
  const d = new Date(ms);
  return `${localKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shift a start datetime by a (possibly fractional) number of days. */
export function shiftStart(startIso: string, deltaDays: number): string {
  return toIso(parseLocal(startIso).getTime() + deltaDays * DAY_MS);
}

/**
 * The next day boundary (local midnight) at least 12.5 h away in `dir`:
 *   dir > 0 → the smallest midnight ≥ start + 12.5 h;
 *   dir < 0 → the largest  midnight ≤ start − 12.5 h.
 */
export function arrowTarget(startIso: string, dir: number): string {
  const startMs = parseLocal(startIso).getTime();
  if (dir > 0) {
    const threshold = startMs + MIN_ADVANCE_MS;
    const t = new Date(threshold);
    const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const key = localKey(t);
    return midnight >= threshold ? `${key}T00:00` : `${addDays(key, 1)}T00:00`;
  }
  const t = new Date(startMs - MIN_ADVANCE_MS);
  return `${localKey(t)}T00:00`;
}

/** Clamp an ISO start between two ISO bounds (lexicographic — all normalised). */
export function clampStartIso(iso: string, lo: string, hi: string): string {
  return iso < lo ? lo : iso > hi ? hi : iso;
}
