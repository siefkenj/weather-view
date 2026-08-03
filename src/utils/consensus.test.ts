import { describe, expect, it } from "vitest";
import {
  buildConsensus,
  circularMeanDeg,
  consensusWeatherCode,
  isPrecipCode,
  median,
  type RawMultiForecast,
} from "./consensus";

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("is NaN for an empty set", () => {
    expect(median([])).toBeNaN();
  });
});

describe("circularMeanDeg", () => {
  it("averages across the 0°/360° wrap without landing on 180°", () => {
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0, 5);
    expect(circularMeanDeg([10, 20, 30])).toBeCloseTo(20, 5);
  });
  it("is NaN for an empty set", () => {
    expect(circularMeanDeg([])).toBeNaN();
  });
});

describe("isPrecipCode", () => {
  it("treats drizzle-and-up as precipitation but fog as dry", () => {
    expect(isPrecipCode(51)).toBe(true); // drizzle
    expect(isPrecipCode(63)).toBe(true); // rain
    expect(isPrecipCode(71)).toBe(true); // snow
    expect(isPrecipCode(3)).toBe(false); // overcast
    expect(isPrecipCode(48)).toBe(false); // rime fog — not precip
  });
});

describe("consensusWeatherCode", () => {
  it("reports precipitation when a majority of models show it", () => {
    // The Toronto case: 3 dry, 6 wet → wet wins, representative is a wet code.
    const code = consensusWeatherCode([3, 3, 3, 61, 55, 55, 53, 65, 55]);
    expect(isPrecipCode(code)).toBe(true);
  });

  it("stays dry when precipitation is the minority", () => {
    expect(consensusWeatherCode([3, 3, 3, 61])).toBe(3);
  });

  it("breaks a wet/dry tie in favour of rain", () => {
    expect(isPrecipCode(consensusWeatherCode([3, 3, 61, 63]))).toBe(true);
    expect(isPrecipCode(consensusWeatherCode([3, 61]))).toBe(true);
  });

  it("returns an actual reported code (the within-camp median), never a synthetic one", () => {
    // Median of the dry camp [1,2,3] is 2 — a real code, not an average of codes.
    expect(consensusWeatherCode([1, 2, 3])).toBe(2);
  });

  it("is NaN with no finite codes", () => {
    expect(consensusWeatherCode([])).toBeNaN();
    expect(consensusWeatherCode([NaN])).toBeNaN();
  });
});

// ---- buildConsensus --------------------------------------------------------

/** Assemble a minimal multi-model raw response for models A/B/C. Only the columns
 *  the assertions touch are supplied; the rest reduce to NaN, which is fine. */
function raw(): RawMultiForecast {
  return {
    latitude: 43.7,
    longitude: -79.4,
    timezone: "America/Toronto",
    timezone_abbreviation: "GMT-4",
    utc_offset_seconds: -14400,
    elevation: 100,
    current_units: {},
    current: { time: "2026-08-02T11:15", interval: 900 },
    hourly_units: {},
    hourly: {
      time: ["2026-08-02T10:00", "2026-08-02T11:00", "2026-08-02T12:00"],
      temperature_2m_A: [10, 20, 30],
      temperature_2m_B: [12, 22, 32],
      temperature_2m_C: [14, 24, null], // null → excluded from the last median
      // At the current hour (11:00, index 1): A dry, B & C wet → consensus is rain.
      weather_code_A: [3, 3, 3],
      weather_code_B: [3, 61, 63],
      weather_code_C: [3, 63, 63],
      wind_direction_10m_A: [350, 350, 350],
      wind_direction_10m_B: [10, 10, 10],
      wind_direction_10m_C: [0, 0, 0],
    },
    daily_units: {},
    daily: {
      time: ["2026-08-02", "2026-08-03"],
      weather_code_A: [61, 3],
      weather_code_B: [63, 2],
      weather_code_C: [3, 1], // day 0: 2 of 3 wet → wet; day 1: all dry
      // sunrise fallback: A missing day 2, B missing day 1 → take the first present.
      sunrise_A: ["2026-08-02T06:10", null],
      sunrise_B: [null, "2026-08-03T06:11"],
      temperature_2m_max_A: [25, 26],
      temperature_2m_max_B: [27, 28],
      temperature_2m_max_C: [29, 30],
    },
  };
}

describe("buildConsensus", () => {
  const models = ["A", "B", "C"];
  const out = buildConsensus(raw(), models);

  it("keeps the single-model response shape and the shared time axis", () => {
    expect(out.hourly.time).toHaveLength(3);
    expect(out.daily.time).toEqual(["2026-08-02", "2026-08-03"]);
    expect(out.latitude).toBe(43.7);
  });

  it("takes the per-hour median of numeric fields, ignoring nulls", () => {
    expect(out.hourly.temperature_2m).toEqual([12, 22, 31]); // last: median(30,32)
  });

  it("takes the circular mean of wind direction (no 0/360 wrap blow-up)", () => {
    out.hourly.wind_direction_10m.forEach((d) => expect(d).toBeCloseTo(0, 5));
  });

  it("derives 'current' from the hourly consensus at the current hour", () => {
    // current.time 11:15 → hourly index 1; temp median there is 22.
    expect(out.current.time).toBe("2026-08-02T11:15");
    expect(out.current.temperature_2m).toBe(22);
    // Codes at 11:00 are [3, 61, 63] → 2 of 3 wet → a rain code.
    expect(isPrecipCode(out.current.weather_code)).toBe(true);
  });

  it("votes the daily weather code wet/dry per day", () => {
    expect(isPrecipCode(out.daily.weather_code[0])).toBe(true); // 2 of 3 wet
    expect(isPrecipCode(out.daily.weather_code[1])).toBe(false); // all dry
    expect(out.daily.weather_code[1]).toBe(2); // median of dry camp [1,2,3]
  });

  it("takes sunrise from the first model that has a value", () => {
    expect(out.daily.sunrise).toEqual(["2026-08-02T06:10", "2026-08-03T06:11"]);
  });

  it("reports the consensus makeup for TODAY (matching the day-summary headline)", () => {
    // current.time is 2026-08-02 → daily row 0, codes [61, 63, 3] → 2 of 3 wet.
    expect(out.consensus).toEqual({
      models: ["A", "B", "C"],
      wet: true,
      agree: 2, // A(61) and B(63); C(3) is dry
      total: 3,
    });
  });
});
