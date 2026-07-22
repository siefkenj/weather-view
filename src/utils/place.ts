// The location lives in the URL hash path. To stay shareable and unambiguous
// without a geocoding round-trip, the slug carries a readable label plus the
// coordinates: `toronto-ontario-canada@43.7064,-79.3986`.

import type { Place } from "../api/types";

export const DEFAULT_PLACE: Place = {
  name: "Toronto",
  admin1: "Ontario",
  country: "Canada",
  countryCode: "CA",
  latitude: 43.7064,
  longitude: -79.3986,
  timezone: "America/Toronto",
};

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function slugText(place: Place): string {
  return [place.name, place.admin1, place.country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function placeToSlug(place: Place): string {
  const label = slugText(place) || "location";
  return `${label}@${round(place.latitude)},${round(place.longitude)}`;
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface ParsedSlug {
  name: string;
  latitude?: number;
  longitude?: number;
}

/** Parse a route slug into a display name and (when present) coordinates. */
export function parseSlug(slug: string): ParsedSlug | null {
  const raw = decodeURIComponent(slug ?? "").trim();
  if (!raw) return null;

  const at = raw.lastIndexOf("@");
  const label = at >= 0 ? raw.slice(0, at) : raw;
  const coords = at >= 0 ? raw.slice(at + 1) : "";

  const name = titleCase(label.replace(/-/g, " ").trim()) || "Location";

  if (coords) {
    const [latStr, lonStr] = coords.split(",");
    const latitude = Number(latStr);
    const longitude = Number(lonStr);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { name, latitude, longitude };
    }
  }
  return { name };
}

/** Human-readable label, e.g. "Toronto, Ontario, Canada". */
export function placeLabel(place: Place): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
}

/** Short label for compact UI, e.g. "Toronto, ON" or "Toronto, Canada". */
export function placeShortLabel(place: Place): string {
  const region = place.admin1 ?? place.country;
  return region ? `${place.name}, ${region}` : place.name;
}
