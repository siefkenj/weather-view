// In-browser rain-timing optimizer: given each model's historical precipitation and an
// observed truth series (a real rain gauge, or ERA5 reanalysis), find the model
// combination whose MEDIAN consensus times rain best. All series are UTC-hour-keyed
// maps; amount is ignored — only WHEN it rained matters.
//
// The score is the timing deviation we validated offline (scratchpad/timing_long.py):
// for each hour it actually rained, the nearest combo rain within ±window hours gives a
// signed offset; the std of those offsets is the "jitter" (lower = better timed). Whole
// events the combo missed are reported as detection, not folded into the jitter — so a
// model isn't punished on timing for rain it never produced.

import { median } from "./consensus";

/** Default wet threshold (mm) and match window (hours). */
export const WET_MM = 0.2;
export const MATCH_H = 6;

export interface TimingScore {
  /** Std of the signed hour-offsets (the deviation score; lower is better timed). */
  jitter: number;
  /** Mean signed offset: + = combo rains late, − = early. */
  bias: number;
  /** Fraction of actual rain hours matched within ±window (detection, 0–1). */
  caught: number;
  /** Fraction of combo rain hours with no real rain within ±window (0–1). */
  falseAlarm: number;
  /** Actual rain hours (the denominator for `caught`). */
  nActual: number;
}

/** Absolute UTC hour indices where precip ≥ threshold, sorted ascending. */
export function wetHours(precipByUtc: Record<string, number>, thr = WET_MM): number[] {
  const out: number[] = [];
  for (const [iso, mm] of Object.entries(precipByUtc)) {
    if (Number.isFinite(mm) && mm >= thr) out.push(hourIndex(iso));
  }
  return out.sort((a, b) => a - b);
}

/** "YYYY-MM-DDTHH:mm" (UTC) → whole hours since the epoch. */
export function hourIndex(iso: string): number {
  return Math.floor(Date.parse(`${iso}Z`) / 3_600_000);
}

/** Nearest value to `x` in a sorted array (binary search). */
function nearest(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (x <= sorted[0]) return sorted[0];
  if (x >= sorted[hi]) return sorted[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] === x) return x;
    if (sorted[mid] < x) lo = mid;
    else hi = mid;
  }
  return x - sorted[lo] <= sorted[hi] - x ? sorted[lo] : sorted[hi];
}

/** Timing deviation of a combo's rain hours against the actual rain hours. */
export function timingScore(actualWet: number[], comboWet: number[], windowH = MATCH_H): TimingScore | null {
  if (actualWet.length === 0 || comboWet.length === 0) return null;
  const offsets: number[] = [];
  for (const x of actualWet) {
    const d = nearest(comboWet, x) - x;
    if (Math.abs(d) <= windowH) offsets.push(d);
  }
  if (offsets.length === 0) return null; // caught nothing within the window
  const n = offsets.length;
  const bias = offsets.reduce((s, d) => s + d, 0) / n;
  const jitter = Math.sqrt(offsets.reduce((s, d) => s + (d - bias) ** 2, 0) / n);
  let fa = 0;
  for (const y of comboWet) if (Math.abs(nearest(actualWet, y) - y) > windowH) fa++;
  return {
    jitter,
    bias,
    caught: offsets.length / actualWet.length,
    falseAlarm: fa / comboWet.length,
    nActual: actualWet.length,
  };
}

/** Per-hour median precip over a subset of models (the app's consensus rule). */
export function medianConsensus(
  byModel: Record<string, Record<string, number>>,
  times: string[],
  subset: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of times) {
    const vals: number[] = [];
    for (const m of subset) {
      const v = byModel[m]?.[t];
      if (Number.isFinite(v)) vals.push(v);
    }
    if (vals.length) out[t] = median(vals);
  }
  return out;
}

export interface Combination extends TimingScore {
  models: string[];
}

/** Every non-empty subset of `models` (used to enumerate combinations). */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const s: T[] = [];
    for (let i = 0; i < items.length; i++) if (mask & (1 << i)) s.push(items[i]);
    out.push(s);
  }
  return out;
}

export interface RankOptions {
  /** How many ranked combinations to return. */
  limit?: number;
  /** Keep combos whose detection is ≥ this × the best single model's detection, so a
   *  combo can't win by barely raining. */
  caughtFloorFactor?: number;
  wetThreshold?: number;
  windowH?: number;
}

/**
 * Rank model combinations by rain-timing jitter against `truth`. Singletons are
 * included (a single model may win). Combos below the detection floor are dropped.
 */
export function rankCombinations(
  byModel: Record<string, Record<string, number>>,
  truth: Record<string, number>,
  models: string[],
  opts: RankOptions = {},
): Combination[] {
  const { limit = 6, caughtFloorFactor = 0.75, wetThreshold = WET_MM, windowH = MATCH_H } = opts;
  const times = Array.from(new Set(Object.values(byModel).flatMap((m) => Object.keys(m)))).sort();
  const actualWet = wetHours(truth, wetThreshold);

  // Best single-model detection sets the floor (guards against "barely rains" winners).
  let bestSingleCaught = 0;
  for (const m of models) {
    const s = timingScore(actualWet, wetHours(byModel[m] ?? {}, wetThreshold), windowH);
    if (s && s.caught > bestSingleCaught) bestSingleCaught = s.caught;
  }
  const floor = bestSingleCaught * caughtFloorFactor;

  const scored: Combination[] = [];
  for (const subset of subsets(models)) {
    const consensus = subset.length === 1 ? (byModel[subset[0]] ?? {}) : medianConsensus(byModel, times, subset);
    const s = timingScore(actualWet, wetHours(consensus, wetThreshold), windowH);
    if (s && s.caught >= floor) scored.push({ models: subset, ...s });
  }
  // Best timing first; on a tie prefer the simpler blend, then fewer false alarms.
  scored.sort(
    (a, b) => a.jitter - b.jitter || a.models.length - b.models.length || a.falseAlarm - b.falseAlarm,
  );
  return scored.slice(0, limit);
}
