import { describe, expect, it } from "vitest";
import {
  collectMemberSeries,
  computeBands,
  percentileBands,
  quantileSorted,
  recenterBandOnLine,
} from "./ensemble";
import type { EnsembleResponse } from "./types";

describe("quantileSorted", () => {
  it("interpolates between values", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([10, 20], 0.1)).toBeCloseTo(11);
    expect(quantileSorted([5], 0.9)).toBe(5);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });
});

describe("percentileBands", () => {
  it("produces ordered lower <= median <= upper per timestep", () => {
    const series = [
      [10, 20],
      [12, 22],
      [8, 18],
    ];
    const { lower, median, upper } = percentileBands(series, 0.1, 0.9);
    expect(median[0]).toBe(10);
    expect(lower[0]).toBeLessThanOrEqual(median[0]);
    expect(upper[0]).toBeGreaterThanOrEqual(median[0]);
    expect(lower[1]).toBeLessThan(upper[1]);
  });

  it("ignores non-finite members", () => {
    const series = [
      [10, NaN],
      [12, 22],
    ];
    const { median } = percentileBands(series, 0.1, 0.9);
    expect(median[1]).toBe(22);
  });
});

describe("collectMemberSeries / computeBands", () => {
  const ensemble: EnsembleResponse = {
    latitude: 0,
    longitude: 0,
    timezone: "UTC",
    utc_offset_seconds: 0,
    hourly_units: {},
    hourly: {
      time: ["2026-07-22T00:00", "2026-07-22T01:00"],
      temperature_2m: [10, 20],
      temperature_2m_member01: [12, 22],
      temperature_2m_member02: [8, 18],
      precipitation: [0, 1],
      precipitation_member01: [0, 2],
    },
  };

  it("collects the control run plus members for a variable", () => {
    expect(collectMemberSeries(ensemble.hourly, "temperature_2m")).toHaveLength(3);
    expect(collectMemberSeries(ensemble.hourly, "precipitation")).toHaveLength(2);
  });

  it("computes bands aligned to the time axis", () => {
    const bands = computeBands(ensemble, "temperature_2m");
    expect(bands.time).toEqual(ensemble.hourly.time);
    expect(bands.median[0]).toBe(10);
    expect(bands.lower.length).toBe(2);
  });
});

describe("recenterBandOnLine", () => {
  it("hangs the ensemble spread on the displayed line, not the ensemble median", () => {
    const band = { time: ["t0", "t1"], lower: [8, 9], median: [10, 12], upper: [13, 15] };
    const line = [20, 30]; // e.g. the best_match composite, offset from the ensemble
    const out = recenterBandOnLine(band, line);
    // spread preserved: lower = line - (median - lower), upper = line + (upper - median)
    expect(out.lower).toEqual([18, 27]);
    expect(out.upper).toEqual([23, 33]);
    expect(out.median).toEqual([20, 30]);
  });
});
