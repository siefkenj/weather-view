// Recently-viewed locations, persisted to localStorage, so the search box can offer
// them the moment it's opened (before the user types). Identity/dedup is by the same
// slug the router uses (label@lat,lon), so the same city never appears twice.

import type { Place } from "../api/types";
import { placeToSlug } from "./place";

const KEY = "wv:recents:v1";
// Keep a few more than we display, so excluding the current place still leaves 5.
const MAX_STORED = 8;

function isPlace(p: unknown): p is Place {
  if (!p || typeof p !== "object") return false;
  const c = p as Partial<Place>;
  return typeof c.name === "string" && typeof c.latitude === "number" && typeof c.longitude === "number";
}

/** The stored recents, most-recent first. Tolerant of missing/corrupt storage. */
export function getRecentPlaces(): Place[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlace) : [];
  } catch {
    return [];
  }
}

/** Move `place` to the front (deduped by slug), cap the list, and persist it. */
export function addRecentPlace(place: Place): void {
  if (!isPlace(place)) return;
  const key = placeToSlug(place);
  const next = [place, ...getRecentPlaces().filter((p) => placeToSlug(p) !== key)].slice(0, MAX_STORED);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable / quota — recents are best-effort */
  }
}

/** Clear the stored recents (used by the settings reset). */
export function clearRecentPlaces(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
