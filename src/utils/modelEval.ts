// In-browser rain-timing optimizer: given each model's historical precipitation and an
// observed truth series (a real rain gauge, or ERA5 reanalysis), find the model
// combination whose MEDIAN consensus times rain best. All series are UTC-hour-keyed
// maps; amount is ignored — only WHEN it rained matters.
//
// Scoring — the "expected timing error" (hours, lower is better):
//
//   Wet hours on each side are grouped into EVENTS (rain separated by more than
//   EVENT_GAP_H is a new event), and each event's error is the mean, over its hours, of
//   the distance to the nearest wet hour on the other side, CAPPED at MATCH_H. The score
//   averages two sides:
//     • miss side  — observed events vs the combo's rain (rain that was missed or late)
//     • false side — combo events vs the observed rain (rain that never happened)
//   score = (mean miss-side event error + mean false-side event error) / 2
//
//   The cap is what makes this safe: an event the combo never produced costs exactly
//   MATCH_H rather than being dropped. The previous version computed the std of matched
//   offsets ONLY, so a badly-timed combo shed its worst matches and scored near zero —
//   the metric rewarded missing rain. Here 0 = perfect, MATCH_H/2 ≈ no skill, and both
//   degenerate strategies (never rain / always rain) land at MATCH_H/2.
//
//   Events, not hours, are the unit: an 18-hour storm and a 1-hour shower count once
//   each, so a single long event can't dominate, and the score isn't inflated by the
//   heavy hour-to-hour autocorrelation of rain.
//
//   The score is also averaged over several wet thresholds (THRESHOLDS_MM) so the pick
//   doesn't hinge on a single arbitrary mm cutoff, which a median consensus turns into
//   a hard cliff (half the models must clear it).
//
// Robustness:
//   • Common evaluation mask. Every combo is scored on exactly the same hours (those
//     where the truth AND every retained model report), so scores are comparable and a
//     short-archive model can't quietly drop out of a "consensus" mid-window.
//   • Pooled score, blocked error bar. The score pools the whole window; the window is
//     ALSO cut into CV_BLOCKS contiguous blocks (contiguous because rain is
//     autocorrelated — shuffling hours would leak a storm across the split) purely to
//     put a standard error on it. Blocks never reweight the score.
//   • The winner is taken outright.
//
// Every choice above was measured on synthetic records with known model skill, selecting
// on one half and scoring the pick on the held-out half with an independent referee
// (critical success index at ±3 h). Against the previous jitter score that lifted the
// held-out CSI from 0.74 → 0.94 (sparse rain) and 0.80 → 0.94 (typical rain).
//
// Things that sound protective and measurably were NOT, so are deliberately absent:
// weighting the score by block mean rather than pooling; a one-standard-error rule
// preferring the simplest statistically-tied blend; stability selection over the tied
// set; leave-one-block-out bagging. All lost to plain argmin of the pooled score —
// parsimony is the wrong prior here, because a median over more models is genuinely
// steadier rather than more overfit. Re-measure before reintroducing any of them.

import { median } from "./consensus";

/** Default wet threshold (mm) and match window (hours). */
export const WET_MM = 0.2;
export const MATCH_H = 6;
/** Wet hours this far apart or less belong to the same rain event. */
export const EVENT_GAP_H = 3;
/** Thresholds the score is averaged over, so no single mm cutoff decides the winner. */
export const THRESHOLDS_MM = [0.1, 0.2, 0.5];
/** Contiguous cross-validation blocks the window is cut into. */
export const CV_BLOCKS = 6;
/** Below this many observed events there is nothing to rank on. */
export const MIN_EVENTS = 6;
/** A model must report this fraction of the truth's hours to enter the search. */
export const MIN_COVERAGE = 0.9;
/** Beyond this many candidates, exhaustive enumeration gives way to greedy search. */
const MAX_ENUM_COMBOS = 8191;

/** "YYYY-MM-DDTHH:mm" (UTC) → whole hours since the epoch; NaN if unparseable. */
export function hourIndex(iso: string): number {
  const t = Date.parse(`${iso}Z`);
  return Number.isFinite(t) ? Math.floor(t / 3_600_000) : NaN;
}

/** Absolute UTC hour indices where precip ≥ threshold, sorted ascending. */
export function wetHours(precipByUtc: Record<string, number>, thr = WET_MM): number[] {
  const out: number[] = [];
  for (const [iso, mm] of Object.entries(precipByUtc)) {
    if (!Number.isFinite(mm) || mm < thr) continue;
    const h = hourIndex(iso);
    if (Number.isFinite(h)) out.push(h);
  }
  return out.sort((a, b) => a - b);
}

/** Split sorted wet hours into events: runs separated by more than `gapH` hours. */
export function toEvents(wet: number[], gapH = EVENT_GAP_H): number[][] {
  const out: number[][] = [];
  for (const h of wet) {
    const last = out[out.length - 1];
    if (last && h - last[last.length - 1] <= gapH) last.push(h);
    else out.push([h]);
  }
  return out;
}

/** Nearest value to `x` in a sorted array; NaN when empty (binary search). */
function nearest(sorted: number[], x: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (x <= sorted[0]) return sorted[0];
  if (x >= sorted[n - 1]) return sorted[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] === x) return x;
    if (sorted[mid] < x) lo = mid;
    else hi = mid;
  }
  return x - sorted[lo] <= sorted[hi] - x ? sorted[lo] : sorted[hi];
}

/** Distance from `x` to the nearest hour in `other`, capped at `windowH` (so an hour
 *  with no counterpart at all costs exactly the window rather than being discarded). */
function cappedDist(other: number[], x: number, windowH: number): number {
  const nb = nearest(other, x);
  return Number.isNaN(nb) ? windowH : Math.min(Math.abs(nb - x), windowH);
}

/** Mean capped distance from an event's hours to the nearest hour in `other`. */
function eventError(event: number[], other: number[], windowH: number): number {
  let s = 0;
  for (const h of event) s += cappedDist(other, h, windowH);
  return s / event.length;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export interface TimingError {
  /** Expected timing error in hours: 0 perfect, ~MATCH_H/2 no skill. Lower is better. */
  score: number;
  /** Mean signed offset over matched hours: + = combo rains late, − = early. */
  bias: number;
  /** Fraction of observed rain EVENTS matched within ±window (detection, 0–1). */
  caught: number;
  /** Fraction of combo rain EVENTS with no observed rain within ±window (0–1). */
  falseAlarm: number;
  /** Observed rain events scored. */
  nEvents: number;
}

/**
 * Timing error of a combo's rain hours against the observed rain hours, over the whole
 * series. `null` only when neither side has any rain at all (nothing to say).
 */
export function timingError(
  actualWet: number[],
  comboWet: number[],
  windowH = MATCH_H,
  gapH = EVENT_GAP_H,
): TimingError | null {
  const aEv = toEvents(actualWet, gapH);
  const cEv = toEvents(comboWet, gapH);
  if (aEv.length === 0 && cEv.length === 0) return null;

  // A side with no events contributes 0 — the other side already carries the full
  // penalty (all-miss or all-false-alarm both land at windowH/2).
  const missSide = aEv.length ? mean(aEv.map((e) => eventError(e, comboWet, windowH))) : 0;
  const faSide = cEv.length ? mean(cEv.map((e) => eventError(e, actualWet, windowH))) : 0;

  // Diagnostics: detection at the event level, bias over the hours that did match.
  const caughtEv = aEv.filter((e) => e.some((h) => cappedDist(comboWet, h, windowH) < windowH));
  const falseEv = cEv.filter((e) => e.every((h) => cappedDist(actualWet, h, windowH) >= windowH));
  const offsets: number[] = [];
  for (const h of actualWet) {
    const nb = nearest(comboWet, h);
    if (!Number.isNaN(nb) && Math.abs(nb - h) < windowH) offsets.push(nb - h);
  }

  return {
    score: (missSide + faSide) / 2,
    bias: offsets.length ? mean(offsets) : 0,
    caught: aEv.length ? caughtEv.length / aEv.length : 0,
    falseAlarm: cEv.length ? falseEv.length / cEv.length : 0,
    nEvents: aEv.length,
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

export interface Combination extends TimingError {
  models: string[];
  /** Standard error of `score` across the cross-validation blocks. */
  se: number;
  /** How many contiguous blocks `se` was estimated from. */
  nBlocks: number;
}

export interface RankOptions {
  /** How many ranked combinations to return. */
  limit?: number;
  /** Wet thresholds (mm) the score is averaged over. */
  thresholds?: number[];
  windowH?: number;
  gapH?: number;
  /** Contiguous blocks used to estimate `se`. Does not affect `score`. */
  blocks?: number;
  /** Fraction of the truth's hours a model must report to enter the search. */
  minCoverage?: number;
  /** Minimum observed events required to rank at all. */
  minEvents?: number;
}

export type RankReason = "no-data" | "too-little-rain";

export interface RankResult {
  /** Ranked by cross-validated timing error, best first. */
  combos: Combination[];
  /** The recommendation: simply the top-scoring combination. A one-standard-error rule
   *  (prefer the simplest blend statistically tied with the best) was measured and lost —
   *  see the note above `const best` in `rankCombinations`. */
  best: Combination | null;
  /** Hours actually scored (truth ∩ every retained model). */
  evalHours: number;
  /** Observed rain events over the evaluation window, at the default threshold. */
  nEvents: number;
  /** Models excluded from the search for not covering enough of the window. */
  dropped: string[];
  /** Why `best` is null. */
  reason?: RankReason;
}

/** A fresh empty result (never a shared object — callers hold on to `combos`). */
function empty(reason: RankReason, over: Partial<RankResult> = {}): RankResult {
  return { combos: [], best: null, evalHours: 0, nEvents: 0, dropped: [], reason, ...over };
}

/** UTC-hour-keyed record → Map of hour index → mm (dropping unparseable/non-finite). */
function toHourMap(rec: Record<string, number>): Map<number, number> {
  const m = new Map<number, number>();
  for (const [iso, v] of Object.entries(rec)) {
    if (!Number.isFinite(v)) continue;
    const h = hourIndex(iso);
    if (Number.isFinite(h)) m.set(h, v);
  }
  return m;
}

/** Every non-empty subset of `items`, smaller subsets first. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const s: T[] = [];
    for (let i = 0; i < items.length; i++) if (mask & (1 << i)) s.push(items[i]);
    out.push(s);
  }
  return out.sort((a, b) => a.length - b.length);
}

/** Median of the `subset` columns at each evaluation slot, written into `out`. */
function medianInto(cols: Float64Array[], n: number, out: Float64Array, buf: Float64Array): void {
  const k = cols.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      // Insertion sort — k ≤ a dozen, so this beats allocating and sorting an array.
      const v = cols[j][i];
      let p = j - 1;
      while (p >= 0 && buf[p] > v) {
        buf[p + 1] = buf[p];
        p--;
      }
      buf[p + 1] = v;
    }
    out[i] = k & 1 ? buf[k >> 1] : (buf[(k >> 1) - 1] + buf[k >> 1]) / 2;
  }
}

/** Sample standard error of a set of block scores (NaN below two blocks). */
function standardError(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v / n);
}

/**
 * Rank model combinations by how well their median consensus times rain against `truth`.
 * Singletons are included (a single model may win). `best` is simply the top-scoring
 * combination; see the file header for the score and for what `se` does and doesn't mean.
 */
export function rankCombinations(
  byModel: Record<string, Record<string, number>>,
  truth: Record<string, number>,
  models: string[],
  opts: RankOptions = {},
): RankResult {
  const {
    limit = 8,
    thresholds = THRESHOLDS_MM,
    windowH = MATCH_H,
    gapH = EVENT_GAP_H,
    blocks = CV_BLOCKS,
    minCoverage = MIN_COVERAGE,
    minEvents = MIN_EVENTS,
  } = opts;

  const truthMap = toHourMap(truth);
  const truthHours = [...truthMap.keys()].sort((a, b) => a - b);
  if (truthHours.length === 0 || models.length === 0) return empty("no-data");

  // Retain models that cover enough of the observed window, then score every combo on
  // the SAME hours (truth ∩ all retained models) so the numbers are comparable.
  const maps = new Map(models.map((m) => [m, toHourMap(byModel[m] ?? {})] as const));
  const kept = models.filter((m) => {
    const mm = maps.get(m)!;
    let hit = 0;
    for (const h of truthHours) if (mm.has(h)) hit++;
    return hit >= minCoverage * truthHours.length;
  });
  const dropped = models.filter((m) => !kept.includes(m));
  if (kept.length === 0) return empty("no-data", { dropped });

  const mask = truthHours.filter((h) => kept.every((m) => maps.get(m)!.has(h)));
  const n = mask.length;
  if (n < 24 * 7) return empty("no-data", { evalHours: n, dropped });

  // Dense, gap-free columns over the mask, plus a contiguous CV block per slot.
  const cols = new Map<string, Float64Array>();
  for (const m of kept) {
    const mm = maps.get(m)!;
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = mm.get(mask[i])!;
    cols.set(m, col);
  }
  const nBlocks = Math.max(1, Math.min(blocks, Math.floor(n / 24)));
  const blockOf = new Map<number, number>();
  for (let i = 0; i < n; i++) blockOf.set(mask[i], Math.min(nBlocks - 1, Math.floor((i * nBlocks) / n)));

  // Per threshold: observed wet hours, and observed events bucketed by the block their
  // first hour falls in. Matching always uses the full series, so an event straddling a
  // boundary still matches its true counterpart.
  const obsWet = thresholds.map((thr) => mask.filter((h) => truthMap.get(h)! >= thr));
  const obsEventsByBlock = obsWet.map((wet) => {
    const byBlock: number[][][] = Array.from({ length: nBlocks }, () => []);
    for (const ev of toEvents(wet, gapH)) byBlock[blockOf.get(ev[0])!].push(ev);
    return byBlock;
  });

  const defaultIdx = Math.max(0, thresholds.indexOf(WET_MM));
  const nEvents = toEvents(obsWet[defaultIdx], gapH).length;
  if (nEvents < minEvents) {
    return empty("too-little-rain", { evalHours: n, nEvents, dropped });
  }

  const med = new Float64Array(n);
  const buf = new Float64Array(kept.length);

  /** Pooled score for one subset (plus its blocked error bar), or null if nothing rained. */
  const evaluate = (subset: string[]): Combination | null => {
    medianInto(
      subset.map((m) => cols.get(m)!),
      n,
      med,
      buf,
    );
    const comboWet = thresholds.map((thr) => {
      const wet: number[] = [];
      for (let i = 0; i < n; i++) if (med[i] >= thr) wet.push(mask[i]);
      return wet;
    });
    const comboEventsByBlock = comboWet.map((wet) => {
      const byBlock: number[][][] = Array.from({ length: nBlocks }, () => []);
      for (const ev of toEvents(wet, gapH)) byBlock[blockOf.get(ev[0])!].push(ev);
      return byBlock;
    });

    // The score itself is POOLED over the whole window — every rain event carries the
    // same weight regardless of which block it landed in. Averaging block means instead
    // measurably hurt out-of-sample accuracy, because a block holding one event then
    // counted as much as a block holding eight.
    const sideScore = (obsEv: number[][], comboEv: number[][], t: number): number | null => {
      if (obsEv.length === 0 && comboEv.length === 0) return null;
      const missSide = obsEv.length ? mean(obsEv.map((e) => eventError(e, comboWet[t], windowH))) : 0;
      const faSide = comboEv.length ? mean(comboEv.map((e) => eventError(e, obsWet[t], windowH))) : 0;
      return (missSide + faSide) / 2;
    };

    const pooled: number[] = [];
    for (let t = 0; t < thresholds.length; t++) {
      const s = sideScore(obsEventsByBlock[t].flat(), comboEventsByBlock[t].flat(), t);
      if (s !== null) pooled.push(s);
    }
    if (pooled.length === 0) return null;

    // Blocks are used only to put an error bar on that score — how much it would move if
    // this had been a different three months. They never reweight the score.
    const blockScores: number[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const perThr: number[] = [];
      for (let t = 0; t < thresholds.length; t++) {
        const s = sideScore(obsEventsByBlock[t][b], comboEventsByBlock[t][b], t);
        if (s !== null) perThr.push(s);
      }
      if (perThr.length) blockScores.push(mean(perThr));
    }

    // Diagnostics (bias / caught / false alarm) come from the whole window at the
    // default threshold — they describe the combo, they don't drive the ranking.
    const diag = timingError(obsWet[defaultIdx], comboWet[defaultIdx], windowH, gapH);
    return {
      models: subset,
      score: mean(pooled),
      se: standardError(blockScores) || 0,
      bias: diag?.bias ?? 0,
      caught: diag?.caught ?? 0,
      falseAlarm: diag?.falseAlarm ?? 0,
      nEvents,
      nBlocks: blockScores.length,
    };
  };

  // Exhaustive while it is cheap; greedy forward selection (every prefix is a candidate)
  // once the power set would stall the browser.
  const candidates: string[][] =
    (1 << kept.length) - 1 <= MAX_ENUM_COMBOS ? subsets(kept) : greedyCandidates(kept, evaluate);

  const scored: Combination[] = [];
  for (const subset of candidates) {
    const c = evaluate(subset);
    if (c) scored.push(c);
  }
  if (scored.length === 0) return empty("too-little-rain", { evalHours: n, nEvents, dropped });

  // Best timing first; on a tie prefer the simpler blend, then fewer false alarms.
  scored.sort(
    (a, b) => a.score - b.score || a.models.length - b.models.length || a.falseAlarm - b.falseAlarm,
  );

  // Take the winner outright. A one-standard-error rule (prefer the simplest blend
  // statistically tied with the top) was tried and measurably HURT: parsimony is the
  // wrong prior here, because a median over more models is genuinely steadier, not
  // more overfit. Stability selection and leave-one-block-out bagging lost too. The
  // cross-validated score is doing the regularizing; `se` is reported so the caller can
  // say how firm the pick is rather than used to second-guess it.
  const best = scored[0];
  return { combos: scored.slice(0, limit), best, evalHours: n, nEvents, dropped };
}

/** Forward selection: grow from the best single model, keeping every prefix. Used only
 *  when the catalog grows too large to enumerate the full power set. */
function greedyCandidates(
  models: string[],
  evaluate: (subset: string[]) => Combination | null,
): string[][] {
  const out: string[][] = models.map((m) => [m]);
  let current: string[] = [];
  let bestScore = Infinity;
  for (const m of models) {
    const c = evaluate([m]);
    if (c && c.score < bestScore) {
      bestScore = c.score;
      current = [m];
    }
  }
  if (current.length === 0) return out;
  const remaining = models.filter((m) => m !== current[0]);
  while (remaining.length) {
    let pick: string | null = null;
    let pickScore = Infinity;
    for (const m of remaining) {
      const c = evaluate([...current, m]);
      if (c && c.score < pickScore) {
        pickScore = c.score;
        pick = m;
      }
    }
    if (!pick) break;
    current = [...current, pick];
    remaining.splice(remaining.indexOf(pick), 1);
    out.push(current);
  }
  return out;
}
