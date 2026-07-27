// Keyless wind vector-field data for the radar map, sampled on a QUANTIZED global
// lattice so panning/zooming reuses cached points instead of refetching.
//
// The lattice spacing is tied to the (integer) zoom level, so arrows keep a roughly
// constant on-screen density and every viewport needs a bounded number of points.
// Each lattice cell has a stable key; a WindFieldCache merges fetched cells and only
// the cells NOT already cached are requested on each move — so a small pan fetches a
// thin strip (or nothing), not a whole fresh grid. Open-Meteo's forecast API takes
// many coordinates in one request, so a cell batch is a single call.

import type { LatLonBounds } from "./airQualityGrid";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// On-screen spacing of DATA samples (not arrows — arrows are drawn denser and
// interpolated). The lattice step hits this at the current data zoom.
const DATA_SPACING_PX = 80;
const MAX_LATTICE_POINTS = 360; // safety cap (multi-location is URL-length bounded)

// The wind model is ~11 km, so there's no point fetching finer than this. Capping
// the DATA zoom means zooming in past it reuses the cached grid (no refetch, no
// request bursts) and the layer just interpolates the arrows more finely.
export const DATA_MAX_ZOOM = 10;

/** Zoom level to sample DATA at for a given map zoom (capped at the model res). */
export function dataZoomFor(mapZoom: number): number {
  return Math.min(DATA_MAX_ZOOM, Math.round(mapZoom));
}

export interface WindGridPoint {
  lat: number;
  lon: number;
  speed: (number | null)[]; // km/h
  dir: (number | null)[]; // degrees, meteorological (FROM)
}

export interface WindGrid {
  times: number[]; // unix seconds (UTC), ascending
  points: WindGridPoint[];
}

/** One instant's wind at a point: motion vector (u east, v north) + speed (km/h). */
export interface WindSample {
  lat: number;
  lon: number;
  u: number;
  v: number;
  speed: number | null;
}

/** A wind sample projected to screen pixels (for the arrow-field interpolation). */
export interface ProjSample {
  x: number;
  y: number;
  u: number;
  v: number;
}

/**
 * Inverse-distance-weighted wind vector at (x, y) from projected samples — how the
 * dense arrow grid gets a value everywhere from the coarse data grid (and fills any
 * missing cells). Returns null only when there are no samples; a coincident sample
 * wins outright.
 */
export function idwVector(pts: ProjSample[], x: number, y: number): { u: number; v: number } | null {
  let wu = 0;
  let wv = 0;
  let w = 0;
  for (const p of pts) {
    const dx = x - p.x;
    const dy = y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1) return { u: p.u, v: p.v };
    const wi = 1 / (d2 * d2); // ∝ d^-4 → smooth but locally dominated
    wu += wi * p.u;
    wv += wi * p.v;
    w += wi;
  }
  return w > 0 ? { u: wu / w, v: wv / w } : null;
}

/** A quantized lattice point: a stable cache key plus its coordinates. */
export interface LatticePoint {
  key: string;
  lat: number;
  lon: number;
}

/** Lattice spacing in degrees for a zoom level (quantized to integer zoom). */
export function latticeStepDeg(zoom: number): number {
  const z = Math.round(zoom);
  const degPerPx = 360 / (256 * Math.pow(2, z));
  return degPerPx * DATA_SPACING_PX;
}

/**
 * Lattice points covering `bounds` (plus a margin ring so a small pan stays cached),
 * snapped to the global lattice for this zoom. Keys are stable across pans at the
 * same zoom, so identical cells dedupe/merge in the cache.
 */
export function windLatticePoints(bounds: LatLonBounds, zoom: number, marginCells = 1): LatticePoint[] {
  const z = Math.round(zoom);
  const step = latticeStepDeg(zoom);
  const iLatMin = Math.floor(bounds.south / step) - marginCells;
  const iLatMax = Math.ceil(bounds.north / step) + marginCells;
  const iLonMin = Math.floor(bounds.west / step) - marginCells;
  const iLonMax = Math.ceil(bounds.east / step) + marginCells;

  const points: LatticePoint[] = [];
  for (let iy = iLatMin; iy <= iLatMax && points.length < MAX_LATTICE_POINTS; iy++) {
    const lat = Math.min(85, Math.max(-85, iy * step));
    for (let ix = iLonMin; ix <= iLonMax && points.length < MAX_LATTICE_POINTS; ix++) {
      // Normalise longitude into [-180, 180) for the request; key by raw index so
      // the cell stays stable (worldCopyJump can push lon outside the range).
      let lon = ((((ix * step + 180) % 360) + 360) % 360) - 180;
      if (Object.is(lon, -0)) lon = 0;
      points.push({ key: `${z}|${iy}|${ix}`, lat, lon });
    }
  }
  return points;
}

interface WindLocation {
  latitude: number;
  longitude: number;
  hourly?: { time?: number[]; wind_speed_10m?: (number | null)[]; wind_direction_10m?: (number | null)[] };
}

/** Fetch hourly wind for an explicit list of points, in one multi-location call. */
export async function fetchWindPoints(
  points: { lat: number; lon: number }[],
  signal?: AbortSignal,
): Promise<WindGrid> {
  if (points.length === 0) return { times: [], points: [] };
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", points.map((p) => p.lat.toFixed(4)).join(","));
  url.searchParams.set("longitude", points.map((p) => p.lon.toFixed(4)).join(","));
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("wind_speed_unit", "kmh");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Wind grid request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as WindLocation | WindLocation[];
  const list = Array.isArray(body) ? body : [body];
  const times = list[0]?.hourly?.time ?? [];
  const gridPoints = list.map((loc) => ({
    lat: loc.latitude,
    lon: loc.longitude,
    speed: loc.hourly?.wind_speed_10m ?? [],
    dir: loc.hourly?.wind_direction_10m ?? [],
  }));
  return { times, points: gridPoints };
}

// Meteorological direction (FROM) → motion vector (blowing TOWARD), as east/north
// components: u = -speed·sin(dir), v = -speed·cos(dir).
const toUV = (speed: number | null, dir: number | null): { u: number; v: number } | null => {
  if (speed == null || dir == null) return null;
  const r = (dir * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
};

/**
 * Sample a grid at `unixSec`, interpolating the wind *vector* (not the angle, to
 * avoid 359°→1° wrap) linearly between the two bracketing hours. Clamps to the ends.
 */
export function sampleWindGridAt(grid: WindGrid, unixSec: number): WindSample[] {
  const { times, points } = grid;
  const n = times.length;
  if (n === 0) return points.map((p) => ({ lat: p.lat, lon: p.lon, u: 0, v: 0, speed: null }));

  let lo = 0;
  if (unixSec <= times[0]) lo = 0;
  else if (unixSec >= times[n - 1]) lo = n - 1;
  else while (lo < n - 1 && times[lo + 1] <= unixSec) lo++;
  const hi = Math.min(lo + 1, n - 1);
  const span = times[hi] - times[lo];
  const frac = span > 0 ? (unixSec - times[lo]) / span : 0;

  return points.map((p) => {
    const a = toUV(p.speed[lo], p.dir[lo]);
    const b = toUV(p.speed[hi], p.dir[hi]);
    if (!a && !b) return { lat: p.lat, lon: p.lon, u: 0, v: 0, speed: null };
    const A = a ?? b!;
    const B = b ?? a!;
    const u = A.u + (B.u - A.u) * frac;
    const v = A.v + (B.v - A.v) * frac;
    return { lat: p.lat, lon: p.lon, u, v, speed: Math.hypot(u, v) };
  });
}

/**
 * A mergeable cache of wind cells keyed by lattice cell. Fetched cells accumulate;
 * `missing()` reports which visible cells still need fetching (so we request only
 * the new strip on a pan), and `samplesAt()` reads back the visible cells at a time.
 */
export class WindFieldCache {
  times: number[] = [];
  private cells = new Map<string, WindGridPoint>();

  /** Visible lattice points that aren't cached yet. */
  missing(points: LatticePoint[]): LatticePoint[] {
    return points.filter((p) => !this.cells.has(p.key));
  }

  /** Merge a fetched grid (aligned to `requested`) into the cache. */
  merge(requested: LatticePoint[], grid: WindGrid): void {
    if (grid.times.length) this.times = grid.times;
    grid.points.forEach((pt, i) => {
      const key = requested[i]?.key;
      if (key) this.cells.set(key, pt);
    });
    this.prune();
  }

  /** Interpolated wind samples at `unixSec` for the given (cached) visible cells. */
  samplesAt(points: LatticePoint[], unixSec: number): WindSample[] {
    const grid: WindGrid = { times: this.times, points: [] };
    for (const p of points) {
      const cell = this.cells.get(p.key);
      if (cell) grid.points.push(cell);
    }
    return sampleWindGridAt(grid, unixSec);
  }

  get size(): number {
    return this.cells.size;
  }

  // Bound memory: drop the oldest-inserted cells (Map preserves insertion order).
  private prune(max = 5000): void {
    if (this.cells.size <= max) return;
    let drop = this.cells.size - max;
    for (const k of this.cells.keys()) {
      if (drop-- <= 0) break;
      this.cells.delete(k);
    }
  }
}
