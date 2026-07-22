// Turn raw ensemble members into percentile confidence bands (p10 / p50 / p90).
// The ensemble hourly block holds a control run (`<var>`) plus perturbed members
// (`<var>_member01` … `<var>_memberNN`); we take the spread across all of them.

import type { EnsembleResponse } from "./types";

export interface Bands {
  time: string[];
  lower: number[];
  median: number[];
  upper: number[];
}

/** Gather the control run + every `_memberNN` series for a variable. */
export function collectMemberSeries(
  hourly: EnsembleResponse["hourly"],
  variable: string,
): number[][] {
  const memberPrefix = `${variable}_member`;
  const series: number[][] = [];
  for (const [key, value] of Object.entries(hourly)) {
    if ((key === variable || key.startsWith(memberPrefix)) && Array.isArray(value)) {
      series.push(value as number[]);
    }
  }
  return series;
}

/** Quantile of an already-sorted array using linear interpolation. */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Per-timestep p{low}/p50/p{high} across a set of member series. */
export function percentileBands(series: number[][], lowP = 0.1, highP = 0.9): Omit<Bands, "time"> {
  const length = series.reduce((max, s) => Math.max(max, s.length), 0);
  const lower: number[] = [];
  const median: number[] = [];
  const upper: number[] = [];
  for (let t = 0; t < length; t++) {
    const column: number[] = [];
    for (const s of series) {
      const v = s[t];
      if (typeof v === "number" && Number.isFinite(v)) column.push(v);
    }
    column.sort((a, b) => a - b);
    lower.push(quantileSorted(column, lowP));
    median.push(quantileSorted(column, 0.5));
    upper.push(quantileSorted(column, highP));
  }
  return { lower, median, upper };
}

/** Compute confidence bands for a variable directly from an ensemble response. */
export function computeBands(
  ensemble: EnsembleResponse,
  variable: string,
  lowP = 0.1,
  highP = 0.9,
): Bands {
  const series = collectMemberSeries(ensemble.hourly, variable);
  const { lower, median, upper } = percentileBands(series, lowP, highP);
  return { time: ensemble.hourly.time, lower, median, upper };
}

/**
 * Anchor a band on a separately-forecast line. The ensemble median usually
 * differs from the `best_match` composite we plot, so drawing raw p10/p90 makes
 * the band drift off the line. Instead we keep the ensemble's *relative* spread
 * (median→p10 and median→p90) and hang it on the displayed line, so the band
 * stays centered on the actual prediction while still showing real uncertainty.
 */
export function recenterBandOnLine(band: Bands, line: number[]): Bands {
  const n = Math.min(band.time.length, line.length);
  const lower: number[] = [];
  const upper: number[] = [];
  const median: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = line[i];
    const med = band.median[i];
    const lo = band.lower[i];
    const up = band.upper[i];
    if ([v, med, lo, up].every((x) => Number.isFinite(x))) {
      lower.push(v - (med - lo));
      upper.push(v + (up - med));
      median.push(v);
    } else {
      lower.push(NaN);
      upper.push(NaN);
      median.push(v);
    }
  }
  return { time: band.time.slice(0, n), lower, median, upper };
}
