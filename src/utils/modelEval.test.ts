import { describe, expect, it } from "vitest";
import { hourIndex, medianConsensus, rankCombinations, timingScore, wetHours } from "./modelEval";

// Build a UTC-hour precip map from [hourOffset, mm] pairs (base 2026-06-01T00:00Z).
const BASE = Date.parse("2026-06-01T00:00Z");
const iso = (h: number) => new Date(BASE + h * 3_600_000).toISOString().slice(0, 16);
const mk = (pairs: [number, number][]) => Object.fromEntries(pairs.map(([h, mm]) => [iso(h), mm]));
const wetAt = (hours: number[]) => hours.map((h) => BASE / 3_600_000 + h);

describe("hourIndex / wetHours", () => {
  it("keys hours as whole UTC hours and filters by threshold", () => {
    expect(hourIndex(iso(5)) - hourIndex(iso(4))).toBe(1);
    expect(wetHours(mk([[3, 0.0], [4, 0.1], [5, 0.2], [6, 3]]))).toEqual(wetAt([5, 6]));
  });
});

describe("timingScore", () => {
  it("is a perfect score when the rain hours coincide", () => {
    const s = timingScore(wetAt([10, 11, 12]), wetAt([10, 11, 12]))!;
    expect(s.jitter).toBe(0);
    expect(s.bias).toBe(0);
    expect(s.caught).toBe(1);
    expect(s.falseAlarm).toBe(0);
  });

  it("holds a missed far-off event OUT of the jitter, but lowers 'caught'", () => {
    // gauge rains at 10,11,12 and again at 50; model only catches the first burst.
    const s = timingScore(wetAt([10, 11, 12, 50]), wetAt([10, 11, 12]))!;
    expect(s.jitter).toBe(0); // the caught hours were exact; the 50 miss isn't folded in
    expect(s.caught).toBe(0.75); // 3 of 4 actual rain hours matched within ±6h
  });

  it("measures jitter and early/late bias for shifted rain", () => {
    const s = timingScore(wetAt([10, 11, 12]), wetAt([11, 12, 13]))!;
    expect(s.bias).toBeCloseTo(1 / 3); // slightly late
    expect(s.jitter).toBeGreaterThan(0);
  });

  it("counts rain far from any real rain as a false alarm", () => {
    const s = timingScore(wetAt([10, 11]), wetAt([10, 11, 80]))!;
    expect(s.falseAlarm).toBeCloseTo(1 / 3);
    expect(s.caught).toBe(1);
  });

  it("returns null when nothing matches within the window", () => {
    expect(timingScore(wetAt([10]), wetAt([80]))).toBeNull();
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
  // Two rain events >6h apart, so a model that only rains in the first genuinely misses the second.
  const truth = mk([[10, 2], [11, 2], [12, 2], [50, 2], [51, 2], [52, 2]]);
  const byModel = {
    good: mk([[10, 1], [11, 1], [12, 1], [50, 1], [51, 1], [52, 1]]), // exact timing, catches both
    jitt: mk([[9, 1], [12, 1], [13, 1], [49, 1], [52, 1], [53, 1]]), // off by a bit
    sparse: mk([[10, 1]]), // rains once — catches only event 1, must not win by "barely raining"
  };

  it("ranks by jitter (best first) and includes single models", () => {
    const ranked = rankCombinations(byModel, truth, ["good", "jitt", "sparse"], { limit: 10 });
    expect(ranked.length).toBeGreaterThan(0);
    // sorted ascending by jitter
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].jitter).toBeGreaterThanOrEqual(ranked[i - 1].jitter);
    // the exact-timing model is the top result with ~0 jitter
    expect(ranked[0].jitter).toBeCloseTo(0);
    expect(ranked.some((c) => c.models.length === 1)).toBe(true);
  });

  it("drops combinations below the detection floor (a lone sparse model)", () => {
    const ranked = rankCombinations(byModel, truth, ["good", "jitt", "sparse"], { limit: 20 });
    expect(ranked.some((c) => c.models.length === 1 && c.models[0] === "sparse")).toBe(false);
  });

  it("respects the result limit", () => {
    expect(rankCombinations(byModel, truth, ["good", "jitt", "sparse"], { limit: 2 }).length).toBeLessThanOrEqual(2);
  });
});
