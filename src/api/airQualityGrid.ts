// Keyless air-quality overlay data for the radar map. Open-Meteo's air-quality
// API accepts many coordinates in one request (comma-joined latitude/longitude)
// and returns an array of results, so a whole sampling grid across the visible
// map bounds is a SINGLE call — no key, same source the AQ panel already uses.
//
// We fetch HOURLY US AQI (unix time) over a ±1-day window so the overlay can
// follow the radar timeline: given a timestamp we slice the nearest hour out of
// each point's series. The map interpolates the resulting samples into a smooth
// field client-side (see components/aqiGridLayer.ts).

import { computeAqhiSeries } from "../utils/aqhi";
import type { AirMode } from "../utils/airColors";

// The unified air-quality colour scheme (shared by every chart) lives in
// utils/airColors; re-exported here so existing import sites keep working.
export {
  aqiColor,
  aqhiColor,
  aqiAlpha,
  aqhiAlpha,
  airFieldColor,
  airFieldAlpha,
  AQI_LEGEND,
  AQHI_LEGEND,
} from "../utils/airColors";
export type { AirMode } from "../utils/airColors";

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
  hourly?: {
    time?: number[];
    us_aqi?: (number | null)[];
    pm2_5?: (number | null)[];
    ozone?: (number | null)[];
    nitrogen_dioxide?: (number | null)[];
  };
}

/**
 * Fetch an hourly air-quality grid across `bounds` in one multi-location request,
 * for either index. For AQI we take `us_aqi` directly; for AQHI we fetch the three
 * pollutants and compute the index per point (same method as the AQ panel). All
 * locations share the same hourly axis, so we take it from the first result.
 */
export async function fetchAqiGrid(
  bounds: LatLonBounds,
  mode: AirMode,
  signal?: AbortSignal,
): Promise<AqiGrid> {
  const pts = aqiGridPoints(bounds);
  const url = new URL(AIR_QUALITY_URL);
  url.searchParams.set("latitude", pts.map((p) => p.lat.toFixed(4)).join(","));
  url.searchParams.set("longitude", pts.map((p) => p.lon.toFixed(4)).join(","));
  url.searchParams.set("hourly", mode === "aqhi" ? "pm2_5,ozone,nitrogen_dioxide" : "us_aqi");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("past_days", "1");
  // 2 days of forecast so the timeline's +6 h window is covered even late in the day.
  url.searchParams.set("forecast_days", "2");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Air-quality grid request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as AqLocation | AqLocation[];
  const list = Array.isArray(body) ? body : [body];
  const times = list[0]?.hourly?.time ?? [];
  const points = list.map((loc) => ({
    lat: loc.latitude,
    lon: loc.longitude,
    values: mode === "aqhi" ? aqhiSeriesFor(loc.hourly) : (loc.hourly?.us_aqi ?? []),
  }));
  return { times, points };
}

/** Per-hour AQHI for one location (NaN → null so gaps interpolate/skip cleanly). */
function aqhiSeriesFor(hourly: AqLocation["hourly"]): (number | null)[] {
  return computeAqhiSeries({
    ozone: (hourly?.ozone ?? []) as number[],
    nitrogen_dioxide: (hourly?.nitrogen_dioxide ?? []) as number[],
    pm2_5: (hourly?.pm2_5 ?? []) as number[],
  }).map((v) => (Number.isFinite(v) ? v : null));
}

/**
 * Sample the grid at `unixSec`, linearly interpolating each point between its two
 * bracketing hourly values so the field changes smoothly as the timeline scrubs
 * (rather than stepping once per hour). Clamps to the ends of the series; if one
 * side of a bracket is null it falls back to the other.
 */
export function sampleAqiGridAt(grid: AqiGrid, unixSec: number): AqiSample[] {
  const { times, points } = grid;
  const n = times.length;
  if (n === 0) return points.map((p) => ({ lat: p.lat, lon: p.lon, aqi: null }));

  // Locate the interval times[lo] <= unixSec <= times[lo+1] (clamped to the ends).
  let lo = 0;
  if (unixSec <= times[0]) lo = 0;
  else if (unixSec >= times[n - 1]) lo = n - 1;
  else {
    while (lo < n - 1 && times[lo + 1] <= unixSec) lo++;
  }
  const hi = Math.min(lo + 1, n - 1);
  const span = times[hi] - times[lo];
  const frac = span > 0 ? (unixSec - times[lo]) / span : 0;

  return points.map((p) => {
    const a = p.values[lo];
    const b = p.values[hi];
    let aqi: number | null;
    if (a == null && b == null) aqi = null;
    else if (a == null) aqi = b ?? null;
    else if (b == null) aqi = a;
    else aqi = a + (b - a) * frac;
    return { lat: p.lat, lon: p.lon, aqi };
  });
}

