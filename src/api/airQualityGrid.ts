// Keyless air-quality overlay data for the radar map. Open-Meteo's air-quality
// API accepts many coordinates in one request (comma-joined latitude/longitude)
// and returns an array of results, so a whole sampling grid across the visible
// map bounds is a SINGLE call — no key, same source the AQ panel already uses.
//
// We fetch HOURLY US AQI (unix time) over a ±1-day window so the overlay can
// follow the radar timeline: given a timestamp we slice the nearest hour out of
// each point's series. The map interpolates the resulting samples into a smooth
// field client-side (see components/aqiGridLayer.ts).

const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface LatLonBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** One grid location's hourly US-AQI series (values align with AqiGrid.times). */
export interface AqiGridPoint {
  lat: number;
  lon: number;
  values: (number | null)[];
}

/** A time-indexed grid: a shared hourly time axis + a series per location. */
export interface AqiGrid {
  times: number[]; // unix seconds (UTC), ascending
  points: AqiGridPoint[];
}

/** A single time-slice: US AQI at one instant per location. */
export interface AqiSample {
  lat: number;
  lon: number;
  aqi: number | null;
}

/** Sampling density per axis. 16×16 = 256 points — one request (URL-bounded). */
export const AQI_GRID_N = 16;

/** Evenly spaced lat/lon sample points spanning `bounds` (inclusive corners). */
export function aqiGridPoints(bounds: LatLonBounds, n = AQI_GRID_N): { lat: number; lon: number }[] {
  const { south, west, north, east } = bounds;
  const lerp = (a: number, b: number, i: number) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));
  const pts: { lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push({ lat: lerp(south, north, i), lon: lerp(west, east, j) });
    }
  }
  return pts;
}

interface AqLocation {
  latitude: number;
  longitude: number;
  hourly?: { time?: number[]; us_aqi?: (number | null)[] };
}

/**
 * Fetch an hourly US-AQI grid across `bounds` in one multi-location request.
 * All locations share the same hourly axis, so we take it from the first result.
 */
export async function fetchAqiGrid(bounds: LatLonBounds, signal?: AbortSignal): Promise<AqiGrid> {
  const pts = aqiGridPoints(bounds);
  const url = new URL(AIR_QUALITY_URL);
  url.searchParams.set("latitude", pts.map((p) => p.lat.toFixed(4)).join(","));
  url.searchParams.set("longitude", pts.map((p) => p.lon.toFixed(4)).join(","));
  url.searchParams.set("hourly", "us_aqi");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("forecast_days", "1");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Air-quality grid request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as AqLocation | AqLocation[];
  const list = Array.isArray(body) ? body : [body];
  const times = list[0]?.hourly?.time ?? [];
  const points = list.map((loc) => ({
    lat: loc.latitude,
    lon: loc.longitude,
    values: loc.hourly?.us_aqi ?? [],
  }));
  return { times, points };
}

/** Slice the grid at the hour nearest `unixSec` into a flat set of samples. */
export function sampleAqiGridAt(grid: AqiGrid, unixSec: number): AqiSample[] {
  const { times, points } = grid;
  let idx = 0;
  let best = Infinity;
  for (let k = 0; k < times.length; k++) {
    const d = Math.abs(times[k] - unixSec);
    if (d < best) {
      best = d;
      idx = k;
    }
  }
  return points.map((p) => ({ lat: p.lat, lon: p.lon, aqi: times.length ? (p.values[idx] ?? null) : null }));
}

// US EPA AQI colour breakpoints, interpolated smoothly by value so the field
// reads as a gradient rather than hard category bands.
const AQI_STOPS: { v: number; c: [number, number, number] }[] = [
  { v: 0, c: [0, 228, 0] }, // Good
  { v: 50, c: [0, 228, 0] },
  { v: 100, c: [255, 255, 0] }, // Moderate
  { v: 150, c: [255, 126, 0] }, // Unhealthy for sensitive groups
  { v: 200, c: [255, 0, 0] }, // Unhealthy
  { v: 300, c: [143, 63, 151] }, // Very unhealthy
  { v: 500, c: [126, 0, 35] }, // Hazardous
];

/** Map a US AQI value to an [r,g,b] colour, interpolating between EPA anchors. */
export function aqiColor(aqi: number): [number, number, number] {
  if (Number.isNaN(aqi)) return [128, 128, 128];
  if (aqi <= AQI_STOPS[0].v) return AQI_STOPS[0].c;
  const last = AQI_STOPS[AQI_STOPS.length - 1];
  if (aqi >= last.v) return last.c;
  for (let k = 1; k < AQI_STOPS.length; k++) {
    const b = AQI_STOPS[k];
    if (aqi <= b.v) {
      const a = AQI_STOPS[k - 1];
      const t = (aqi - a.v) / (b.v - a.v);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
      ];
    }
  }
  return last.c;
}

// "Good" air (AQI ≤ 50) is fully transparent; worse air fades in to a semi-
// transparent tint. The ramp spans the whole "Moderate" band (50→100) so the
// greenish low end stays faint and only orange/red reach full opacity.
const AQI_GOOD_MAX = 50;
const AQI_FADE_END = 100;
const AQI_SEMI_ALPHA = 0.6;

/** Overlay opacity (0..1) for a US AQI value: 0 when good, up to semi otherwise. */
export function aqiAlpha(aqi: number): number {
  if (Number.isNaN(aqi) || aqi <= AQI_GOOD_MAX) return 0;
  if (aqi >= AQI_FADE_END) return AQI_SEMI_ALPHA;
  return (AQI_SEMI_ALPHA * (aqi - AQI_GOOD_MAX)) / (AQI_FADE_END - AQI_GOOD_MAX);
}

/** Legend categories (label + representative colour) for the overlay key. */
export const AQI_LEGEND: { label: string; max: number; color: string }[] = [
  { label: "Good", max: 50, color: "rgb(0,228,0)" },
  { label: "Moderate", max: 100, color: "rgb(255,255,0)" },
  { label: "Sensitive", max: 150, color: "rgb(255,126,0)" },
  { label: "Unhealthy", max: 200, color: "rgb(255,0,0)" },
  { label: "Very unhealthy", max: 300, color: "rgb(143,63,151)" },
  { label: "Hazardous", max: 500, color: "rgb(126,0,35)" },
];
