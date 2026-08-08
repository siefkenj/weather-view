import { describe, expect, it } from "vitest";
import {
  MATCH_H,
  hourIndex,
  medianConsensus,
  rankCombinations,
  timingError,
  toEvents,
  wetHours,
} from "./modelEval";

// Build a UTC-hour precip map from [hourOffset, mm] pairs (base 2026-06-01T00:00Z).
const BASE = Date.parse("2026-06-01T00:00Z");
const iso = (h: number) => new Date(BASE + h * 3_600_000).toISOString().slice(0, 16);
const mk = (pairs: [number, number][]) => Object.fromEntries(pairs.map(([h, mm]) => [iso(h), mm]));
const wetAt = (hours: number[]) => hours.map((h) => BASE / 3_600_000 + h);

/** A dense series: `mm` at each listed hour, 0 everywhere else in [0, span). */
const dense = (wet: number[], span: number, mm = 2): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let h = 0; h < span; h++) out[iso(h)] = wet.includes(h) ? mm : 0;
  return out;
};
/** Shift a set of wet hours by `d`. */
const shift = (hours: number[], d: number) => hours.map((h) => h + d);

describe("hourIndex / wetHours", () => {
  it("keys hours as whole UTC hours and filters by threshold", () => {
    expect(hourIndex(iso(5)) - hourIndex(iso(4))).toBe(1);
    expect(wetHours(mk([[3, 0.0], [4, 0.1], [5, 0.2], [6, 3]]))).toEqual(wetAt([5, 6]));
  });

  it("ignores unparseable keys and non-finite amounts", () => {
    expect(wetHours({ "not-a-date": 5, [iso(1)]: NaN, [iso(2)]: 1 })).toEqual(wetAt([2]));
  });
});

describe("toEvents", () => {
  it("groups wet hours separated by more than the gap into distinct events", () => {
    expect(toEvents([1, 2, 3, 20, 21, 40], 3)).toEqual([[1, 2, 3], [20, 21], [40]]);
  });

  it("bridges a short dry spell inside one storm", () => {
    expect(toEvents([1, 2, 5, 6], 3)).toEqual([[1, 2, 5, 6]]);
  });
});

describe("timingError", () => {
  it("is zero when the rain hours coincide", () => {
    const s = timingError(wetAt([10, 11, 12]), wetAt([10, 11, 12]))!;
    expect(s.score).toBe(0);
    expect(s.bias).toBe(0);
    expect(s.caught).toBe(1);
    expect(s.falseAlarm).toBe(0);
  });

  it("charges the full window for a missed event instead of dropping it", () => {
    // Observed rain at 10-12 and again at 50; the combo only produces the first burst.
    const s = timingError(wetAt([10, 11, 12, 50]), wetAt([10, 11, 12]))!;
    // Two observed events: one perfect (0), one entirely missed (MATCH_H). The false-alarm
    // side is clean, so the score is the mean of the two miss-side errors, halved.
    expect(s.score).toBeCloseTo(MATCH_H / 2 / 2);
    expect(s.caught).toBe(0.5); // 1 of 2 observed events
  });

  it("scores a never-raining combo and an always-raining combo the same as no skill", () => {
    const actual = wetAt([10, 11, 12, 50, 51]);
    const silent = timingError(actual, [])!;
    const soaked = timingError(actual, wetAt(Array.from({ length: 400 }, (_, i) => i)))!;
    expect(silent.score).toBeCloseTo(MATCH_H / 2);
    // Always-raining catches everything but drowns in false alarms; both land near no-skill.
    expect(soaked.caught).toBe(1);
    expect(soaked.score).toBeGreaterThan(MATCH_H / 4);
  });

  // The old jitter score's fatal flaw: offsets outside the window were discarded, so a
  // combo could improve its score by missing its worst events.
  it("cannot be improved by dropping badly-timed rain", () => {
    const actual = wetAt([10, 20, 30, 40]);
    const wellTimed = timingError(actual, wetAt([11, 21, 31, 41]))!;
    const missesMost = timingError(actual, wetAt([10]))!;
    expect(wellTimed.score).toBeLessThan(missesMost.score);
  });

  it("measures early/late bias for shifted rain", () => {
    expect(timingError(wetAt([10, 30, 50]), wetAt([12, 32, 52]))!.bias).toBeCloseTo(2);
    expect(timingError(wetAt([10, 30, 50]), wetAt([8, 28, 48]))!.bias).toBeCloseTo(-2);
  });

  it("counts rain far from any real rain as a false alarm", () => {
    const s = timingError(wetAt([10, 11]), wetAt([10, 11, 80]))!;
    expect(s.falseAlarm).toBeCloseTo(0.5); // 1 of 2 combo events
    expect(s.caught).toBe(1);
  });

  it("returns null only when neither side has rain", () => {
    expect(timingError([], [])).toBeNull();
    expect(timingError(wetAt([10]), [])).not.toBeNull();
  });
});

describe("medianConsensus", () => {
  it("takes the per-hour median across the subset", () => {
    const byModel = {
      a: mk([[10, 1], [11, 0]]),
      b: mk([[10, 3], [11, 0]]),
      c: mk([[10, 0.1], [11, 5]]),
    };
    const out = medianConsensus(byModel, [iso(10), iso(11)], ["a", "b", "c"]);
    expect(out[iso(10)]).toBe(1); // median(1, 3, 0.1)
    expect(out[iso(11)]).toBe(0); // median(0, 0, 5)
  });
});

describe("rankCombinations", () => {
  const SPAN = 24 * 40; // 40 days, enough for the CV blocks
  // ~20 rain events spread evenly across the window so every block sees rain.
  const EVENTS = Array.from({ length: 20 }, (_, i) => 12 + i * 48);
  const truth = dense(EVENTS.flatMap((h) => [h, h + 1]), SPAN);

  const byModel = {
    good: dense(EVENTS.flatMap((h) => [h, h + 1]), SPAN), // exact
    late: dense(shift(EVENTS, 2).flatMap((h) => [h, h + 1]), SPAN), // 2 h late
    off: dense(shift(EVENTS, 14).flatMap((h) => [h, h + 1]), SPAN), // far outside the window
    dry: dense([], SPAN), // never rains
  };
  const ids = Object.keys(byModel);

  it("ranks the exactly-timed model best and reports a usable window", () => {
    const r = rankCombinations(byModel, truth, ids, { limit: 20 });
    expect(r.combos.length).toBeGreaterThan(0);
    expect(r.combos[0].models).toEqual(["good"]);
    expect(r.combos[0].score).toBeCloseTo(0);
    expect(r.nEvents).toBe(EVENTS.length);
    expect(r.evalHours).toBe(SPAN);
    for (let i = 1; i < r.combos.length; i++) {
      expect(r.combos[i].score).toBeGreaterThanOrEqual(r.combos[i - 1].score);
    }
  });

  it("recommends the top-scoring combination and reports its error bar", () => {
    const r = rankCombinations(byModel, truth, ids, { limit: 20 });
    expect(r.best).toBe(r.combos[0]);
    expect(r.best!.se).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.best!.se)).toBe(true);
    expect(r.best!.nBlocks).toBeGreaterThan(1);
  });

  it("pools the score, so a lone event can't outweigh a crowd of them", () => {
    // The observed record puts one event in the first block and many in the later ones.
    // Averaging block means would let that lone event count as much as all the rest;
    // pooling makes every event count once.
    const all = [2, 10, 12, 14, 16, 18, 20, 22, 24].map((d) => d * 24 + 6);
    const t = dense(all.flatMap((h) => [h, h + 1]), SPAN);
    const models = {
      crowd: dense(all.slice(1).flatMap((h) => [h, h + 1]), SPAN), // misses only the loner
      loner: dense([all[0], all[0] + 1], SPAN), // nails the loner, misses everything else
    };
    const r = rankCombinations(models, t, ["crowd", "loner"], { limit: 10, minEvents: 4 });
    const score = (m: string) => r.combos.find((c) => c.models.length === 1 && c.models[0] === m)!.score;
    expect(score("crowd")).toBeLessThan(score("loner"));
  });

  it("reproduces the app's median rule, including even-sized blends", () => {
    // buildConsensus takes the plain median, so with two models the "consensus" is their
    // mean — which crosses a low wet threshold whenever EITHER model rains. The optimizer
    // must model that faithfully rather than assume a majority vote.
    const a = [12, 60, 108, 156, 204, 252, 300, 348].map((h) => h);
    const b = a.map((h) => h + 400);
    const t = dense([...a, ...b].flatMap((h) => [h, h + 1]), 24 * 40);
    const models = {
      one: dense(a.flatMap((h) => [h, h + 1]), 24 * 40),
      two: dense(b.flatMap((h) => [h, h + 1]), 24 * 40),
    };
    const r = rankCombinations(models, t, ["one", "two"], { limit: 10 });
    // Each model alone catches half the events; together their mean catches all of them.
    expect(r.best!.models).toEqual(["one", "two"]);
    expect(r.best!.caught).toBe(1);
  });

  it("never prefers a model that misses everything over one that catches it", () => {
    const r = rankCombinations(byModel, truth, ids, { limit: 20 });
    const score = (m: string) => r.combos.find((c) => c.models.length === 1 && c.models[0] === m)!.score;
    expect(score("good")).toBeLessThan(score("late"));
    expect(score("late")).toBeLessThan(score("off"));
    expect(score("late")).toBeLessThan(score("dry"));
  });

  it("scores every combination on the same hours, dropping patchy models", () => {
    // `short` only reports the first 5 days — far under the coverage bar.
    const patchy = { ...byModel, short: dense(EVENTS.flatMap((h) => [h, h + 1]), 24 * 5) };
    const r = rankCombinations(patchy, truth, [...ids, "short"], { limit: 20 });
    expect(r.dropped).toEqual(["short"]);
    expect(r.evalHours).toBe(SPAN); // the retained models still cover the whole window
    expect(r.combos.every((c) => !c.models.includes("short"))).toBe(true);
  });

  it("reports too-little-rain rather than ranking noise", () => {
    const drizzle = dense([12, 13], SPAN);
    const r = rankCombinations(byModel, drizzle, ids);
    expect(r.best).toBeNull();
    expect(r.reason).toBe("too-little-rain");
    expect(r.combos).toEqual([]);
  });

  it("reports no-data for an empty or too-short truth series", () => {
    expect(rankCombinations(byModel, {}, ids).reason).toBe("no-data");
    expect(rankCombinations(byModel, dense(EVENTS, 24 * 3), ids).reason).toBe("no-data");
  });

  it("respects the result limit", () => {
    expect(rankCombinations(byModel, truth, ids, { limit: 3 }).combos.length).toBeLessThanOrEqual(3);
  });

  it("stays fast enough to run on the main thread for the full catalog", () => {
    const many: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 9; i++) {
      many[`m${i}`] = dense(shift(EVENTS, i % 5).flatMap((h) => [h, h + 1]), 24 * 90);
    }
    const big = dense(EVENTS.flatMap((h) => [h, h + 1]), 24 * 90);
    const t0 = performance.now();
    const r = rankCombinations(many, big, Object.keys(many));
    expect(performance.now() - t0).toBeLessThan(4000); // 511 combos × 90 days
    expect(r.best).not.toBeNull();
  });
});
