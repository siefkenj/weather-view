import { describe, expect, it } from "vitest";
import {
  interpBands,
  interpNullable,
  interpSeries,
  refineHourlyWindow,
  sliceFine,
  toFineSamples,
  type FineSamples,
} from "./refine";
import type { HourlyPoint } from "./series";

// 15-minute samples spanning 2026-07-22T00:00 .. 2026-07-23T00:00 inclusive.
function fine(): FineSamples {
  const time: string[] = [];
  const temperature: number[] = [];
  const apparent: number[] = [];
  const precipitation: number[] = [];
  for (let d = 22; d <= 23; d++) {
    const hours = d === 22 ? 24 : 1; // include 07-23T00:00 as the closing point
    for (let h = 0; h < hours; h++) {
      for (let q = 0; q < 4; q++) {
        if (d === 23 && (h > 0 || q > 0)) break;
        const hh = String(h).padStart(2, "0");
        const mm = String(q * 15).padStart(2, "0");
        const t = `2026-07-${d}T${hh}:${mm}`;
        // A value that varies within the hour so 15-min ≠ hourly.
        const frac = h + q / 4;
        time.push(t);
        temperature.push(10 + frac); // strictly increasing → easy to assert
        apparent.push(9 + frac);
        precipitation.push(q === 0 ? 0.4 : 0.1);
      }
    }
  }
  return { time, temperature, apparent, precipitation };
}

function hourlyWindow(): HourlyPoint {
  const time: string[] = [];
  const humidity: number[] = [];
  const pressure: number[] = [];
  const temperature: number[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    time.push(`2026-07-22T${hh}:00`);
    humidity.push(50 + h); // 50..73 — linear, so interpolation is checkable
    pressure.push(1000 + h);
    temperature.push(10 + h);
  }
  const zeros = time.map(() => 0);
  return {
    time,
    temperature,
    apparent: temperature.map((v) => v - 1),
    dewPoint: zeros.slice(),
    precipitation: zeros.slice(),
    precipProbability: zeros.slice(),
    humidity,
    cloudCover: zeros.slice(),
    pressure,
    radiation: zeros.slice(),
  };
}

describe("interpSeries", () => {
  it("linearly resamples onto a finer grid", () => {
    const out = interpSeries(
      ["2026-07-22T00:00", "2026-07-22T01:00"],
      [10, 20],
      ["2026-07-22T00:00", "2026-07-22T00:15", "2026-07-22T00:30", "2026-07-22T01:00"],
    );
    expect(out[0]).toBeCloseTo(10);
    expect(out[1]).toBeCloseTo(12.5);
    expect(out[2]).toBeCloseTo(15);
    expect(out[3]).toBeCloseTo(20);
  });

  it("returns NaN past the ends instead of extrapolating", () => {
    const out = interpSeries(["2026-07-22T01:00", "2026-07-22T02:00"], [5, 9], ["2026-07-22T00:00", "2026-07-22T03:00"]);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });
});

describe("interpNullable", () => {
  it("keeps gaps null when a bracketing value is missing", () => {
    const out = interpNullable(
      ["2026-07-22T00:00", "2026-07-22T01:00", "2026-07-22T02:00"],
      [1, null, 3],
      ["2026-07-22T00:30", "2026-07-22T01:30"],
    );
    expect(out[0]).toBeNull(); // between 1 and null
    expect(out[1]).toBeNull(); // between null and 3
  });
});

describe("sliceFine", () => {
  it("returns the covered sub-window", () => {
    const s = sliceFine(fine(), "2026-07-22T02:00", "2026-07-22T04:00");
    expect(s).not.toBeNull();
    expect(s!.time[0]).toBe("2026-07-22T02:00");
    expect(s!.time[s!.time.length - 1]).toBe("2026-07-22T04:00");
    // 2h at 15-min inclusive = 9 points.
    expect(s!.time).toHaveLength(9);
  });

  it("returns null when the range isn't fully covered", () => {
    expect(sliceFine(fine(), "2026-07-21T00:00", "2026-07-21T06:00")).toBeNull();
  });
});

describe("refineHourlyWindow", () => {
  it("produces a 15-min grid with native temp and interpolated humidity", () => {
    const refined = refineHourlyWindow(hourlyWindow(), fine());
    expect(refined).not.toBeNull();
    const r = refined!;
    // 24h of hourly → ~96 fifteen-minute points.
    expect(r.time.length).toBeGreaterThan(90);
    // Native temperature comes straight from the fine samples (10 + frac).
    expect(r.temperature[0]).toBeCloseTo(10);
    expect(r.temperature[1]).toBeCloseTo(10.25);
    // Humidity is interpolated from the hourly window (50 at 00:00, 51 at 01:00).
    const i0100 = r.time.indexOf("2026-07-22T01:00");
    expect(r.humidity[i0100]).toBeCloseTo(51);
    const i0015 = r.time.indexOf("2026-07-22T00:15");
    expect(r.humidity[i0015]).toBeCloseTo(50.25);
  });

  it("returns null when the fine block doesn't span the window", () => {
    const w = hourlyWindow();
    // Fine block that stops at 06:00 can't cover a full 24h window.
    const short = sliceFine(fine(), "2026-07-22T00:00", "2026-07-22T06:00")!;
    expect(refineHourlyWindow(w, short)).toBeNull();
  });
});

describe("interpBands", () => {
  it("resamples band arrays onto the target grid", () => {
    const band = {
      time: ["2026-07-22T00:00", "2026-07-22T01:00"],
      lower: [0, 10],
      median: [5, 15],
      upper: [10, 20],
    };
    const out = interpBands(["2026-07-22T00:00", "2026-07-22T00:30", "2026-07-22T01:00"], band);
    expect(out.median[1]).toBeCloseTo(10);
    expect(out.lower[1]).toBeCloseTo(5);
    expect(out.upper[1]).toBeCloseTo(15);
  });
});

describe("toFineSamples", () => {
  it("normalises the Open-Meteo field names", () => {
    const s = toFineSamples({
      time: ["2026-07-22T00:00"],
      temperature_2m: [12],
      apparent_temperature: [11],
      precipitation: [0.2],
    });
    expect(s.temperature[0]).toBe(12);
    expect(s.apparent[0]).toBe(11);
    expect(s.precipitation[0]).toBe(0.2);
  });
});
