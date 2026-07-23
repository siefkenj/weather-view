// Refine hourly data onto a 15-minute grid using Open-Meteo's `minutely_15`
// block. Native sub-hourly values (temperature / feels-like / precipitation) come
// straight from the fine samples; the channels the 15-min endpoint doesn't carry
// (humidity, pressure, cloud, dew point, precip probability, radiation) are linearly
// interpolated from the hourly window so the whole HourlyPoint stays on one grid.
//
// Everything degrades gracefully: if the fine samples don't fully span the target
// range the refiners return null and the caller keeps the hourly data.

import type { Minutely15 } from "../api/types";
import type { HourlyPoint } from "./series";
import { parseLocal } from "./format";
import type { Bands } from "../api/ensemble";

/** Normalised 15-minute samples (local ISO time strings, °C, mm). */
export interface FineSamples {
  time: string[];
  temperature: number[];
  apparent: number[];
  precipitation: number[];
}

export function toFineSamples(m: Minutely15): FineSamples {
  return {
    time: m.time,
    temperature: m.temperature_2m,
    apparent: m.apparent_temperature,
    precipitation: m.precipitation,
  };
}

const ms = (iso: string) => parseLocal(iso).getTime();

/** Linear value at `t` given strictly increasing `srcMs`. Returns NaN outside the
 *  source range (so gaps in coverage aren't extrapolated) or when a bracketing
 *  sample isn't finite. */
function valueAt(srcMs: number[], vals: number[], t: number): number {
  const n = srcMs.length;
  if (n === 0 || t < srcMs[0] || t > srcMs[n - 1]) return NaN;
  if (t === srcMs[0]) return vals[0];
  if (t === srcMs[n - 1]) return vals[n - 1];
  // Binary search for the segment [lo, lo+1] containing t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (srcMs[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = vals[lo];
  const b = vals[lo + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const span = srcMs[lo + 1] - srcMs[lo];
  return span > 0 ? a + (b - a) * ((t - srcMs[lo]) / span) : a;
}

/** Linearly resample `vals` (sampled at `srcTime`) onto `dstTime`. */
export function interpSeries(srcTime: string[], vals: number[], dstTime: string[]): number[] {
  const srcMs = srcTime.map(ms);
  return dstTime.map((t) => valueAt(srcMs, vals, ms(t)));
}

/** Like interpSeries but null-aware: a target point is null when either
 *  bracketing source value is null/NaN (so real gaps stay gaps). */
export function interpNullable(
  srcTime: string[],
  vals: (number | null)[],
  dstTime: string[],
): (number | null)[] {
  const srcMs = srcTime.map(ms);
  const clean = vals.map((v) => (v == null || !Number.isFinite(v) ? NaN : v));
  return dstTime.map((t) => {
    const v = valueAt(srcMs, clean, ms(t));
    return Number.isFinite(v) ? v : null;
  });
}

/** True when `fine` spans [startIso, endIso] (so it can be sampled across it). */
function covers(fine: FineSamples, startIso: string, endIso: string): boolean {
  const n = fine.time.length;
  return n > 1 && fine.time[0] <= startIso && fine.time[n - 1] >= endIso;
}

/** The fine samples whose timestamp falls in [startIso, endIso], or null if the
 *  fine block doesn't fully cover that range. Used for the mini "today" graph. */
export function sliceFine(fine: FineSamples, startIso: string, endIso: string): FineSamples | null {
  if (!covers(fine, startIso, endIso)) return null;
  const out: FineSamples = { time: [], temperature: [], apparent: [], precipitation: [] };
  for (let i = 0; i < fine.time.length; i++) {
    const t = fine.time[i];
    if (t >= startIso && t <= endIso) {
      out.time.push(t);
      out.temperature.push(fine.temperature[i]);
      out.apparent.push(fine.apparent[i]);
      out.precipitation.push(fine.precipitation[i]);
    }
  }
  return out.time.length > 1 ? out : null;
}

/**
 * Rebuild an hourly window on the 15-minute grid: native temperature / apparent /
 * precipitation from `fine`, every other channel interpolated from `window`.
 * Returns null (→ caller keeps the hourly window) if `fine` doesn't span it.
 */
export function refineHourlyWindow(window: HourlyPoint, fine: FineSamples): HourlyPoint | null {
  const wn = window.time.length;
  if (wn < 2) return null;
  const startIso = window.time[0];
  const endIso = window.time[wn - 1];
  if (!covers(fine, startIso, endIso)) return null;

  // Fine grid clipped to exactly the window's span.
  const idx: number[] = [];
  for (let i = 0; i < fine.time.length; i++) {
    const t = fine.time[i];
    if (t >= startIso && t <= endIso) idx.push(i);
  }
  if (idx.length < 2) return null;

  const time = idx.map((i) => fine.time[i]);
  const at = (arr: number[]) => idx.map((i) => arr[i]);
  const interp = (arr: number[]) => interpSeries(window.time, arr, time);

  return {
    time,
    temperature: at(fine.temperature),
    apparent: at(fine.apparent),
    precipitation: at(fine.precipitation),
    dewPoint: interp(window.dewPoint),
    precipProbability: interp(window.precipProbability),
    humidity: interp(window.humidity),
    cloudCover: interp(window.cloudCover),
    pressure: interp(window.pressure),
    radiation: interp(window.radiation),
  };
}

/** Resample confidence bands onto `dstTime` (linear; exact when grids match). */
export function interpBands(dstTime: string[], band: Bands): Bands {
  return {
    time: dstTime,
    lower: interpSeries(band.time, band.lower, dstTime),
    median: interpSeries(band.time, band.median, dstTime),
    upper: interpSeries(band.time, band.upper, dstTime),
  };
}
