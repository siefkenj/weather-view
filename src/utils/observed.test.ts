import { describe, expect, it } from "vitest";
import { archiveDailySummaries, mergeObservedDaily, mergeObservedHourly } from "./observed";
import type { DailySummary, HourlyPoint } from "./series";
import type { ArchiveHourly, ArchiveResponse } from "../api/types";

function hourly(times: string[], fill: number): HourlyPoint {
  const a = () => times.map(() => fill);
  return {
    time: times,
    temperature: a(),
    apparent: a(),
    dewPoint: a(),
    precipitation: a(),
    precipProbability: a(),
    humidity: a(),
    cloudCover: a(),
    pressure: a(),
    radiation: a(),
    windSpeed: a(),
    windDirection: a(),
  };
}

const TIMES = ["2026-08-03T08:00", "2026-08-03T09:00", "2026-08-03T10:00", "2026-08-03T11:00"];

function archiveHourly(temperature: (number | null)[]): ArchiveHourly {
  const a = () => TIMES.map(() => 1);
  return {
    time: TIMES,
    temperature_2m: temperature,
    apparent_temperature: a(),
    dew_point_2m: a(),
    precipitation: a(),
    relative_humidity_2m: a(),
    surface_pressure: a(),
    cloud_cover: a(),
    shortwave_radiation: a(),
    wind_speed_10m: a(),
    wind_direction_10m: a(),
  };
}

describe("mergeObservedHourly", () => {
  // now = 10:00; 08:00 & 09:00 are past, 10:00 & 11:00 are present/future.
  const forecast = hourly(TIMES, 50);
  const out = mergeObservedHourly(forecast, archiveHourly([1, null, 3, 4]), "2026-08-03T10:00");

  it("replaces the past with observed values", () => {
    expect(out.temperature[0]).toBe(1); // 08:00 observed
  });

  it("falls back to forecast where the observed value is null", () => {
    expect(out.temperature[1]).toBe(50); // 09:00 observed is null → forecast kept
  });

  it("keeps the present/future on the forecast", () => {
    expect(out.temperature[2]).toBe(50); // 10:00 == now
    expect(out.temperature[3]).toBe(50); // 11:00 future
  });

  it("blanks chance-of-precip in the past (a probability can't be observed)", () => {
    expect(Number.isNaN(out.precipProbability[0])).toBe(true);
    expect(Number.isNaN(out.precipProbability[1])).toBe(true);
    expect(out.precipProbability[2]).toBe(50); // present untouched
  });

  it("does not mutate the forecast input", () => {
    expect(forecast.temperature[0]).toBe(50);
    expect(forecast.precipProbability[0]).toBe(50);
  });
});

describe("mergeObservedHourly with a rain gauge", () => {
  const forecast = hourly(TIMES, 50);
  // gauge covers 08:00 (past) and 11:00 (future); archive has precip everywhere.
  const gauge = { "2026-08-03T08:00": 9, "2026-08-03T11:00": 99 };
  const out = mergeObservedHourly(forecast, archiveHourly([1, 2, 3, 4]), "2026-08-03T10:00", gauge);

  it("prefers gauge precip over ERA5 in the past", () => {
    expect(out.precipitation[0]).toBe(9); // gauge 9 beats archive precip (1)
  });
  it("falls back to ERA5 precip where the gauge has no value", () => {
    expect(out.precipitation[1]).toBe(1); // 09:00: archiveHourly precip fill is 1
  });
  it("never applies the gauge to the present/future", () => {
    expect(out.precipitation[3]).toBe(50); // 11:00 is future → forecast, gauge ignored
  });
});

function mkArchive(daily: ArchiveResponse["daily"]): ArchiveResponse {
  return {
    latitude: 43.7,
    longitude: -79.4,
    timezone: "America/Toronto",
    utc_offset_seconds: -14400,
    hourly_units: {},
    hourly: archiveHourly([1, 2, 3, 4]),
    daily_units: {},
    daily,
  };
}

describe("archiveDailySummaries", () => {
  const s = archiveDailySummaries(
    mkArchive({
      time: ["2026-08-01", "2026-08-02"],
      weather_code: [3, 61],
      sunrise: ["2026-08-01T06:00", "2026-08-02T06:01"],
      sunset: ["2026-08-01T20:00", "2026-08-02T20:01"],
      precipitation_hours: [0, 4],
      precipitation_sum: [0, 5],
      temperature_2m_max: [25, 22],
      temperature_2m_min: [15, 14],
      wind_speed_10m_max: [20, 30],
      wind_direction_10m_dominant: [180, 200],
    }),
  );

  it("reshapes observed daily, leaving UV and precip-chance as NaN", () => {
    expect(s[1].code).toBe(61);
    expect(s[1].tempMax).toBe(22);
    expect(s[1].precipSum).toBe(5);
    expect(Number.isNaN(s[1].uvMax)).toBe(true);
    expect(Number.isNaN(s[1].precipProbMax)).toBe(true);
  });
});

describe("mergeObservedDaily", () => {
  const g = (date: string, code: number): DailySummary => ({
    date,
    code,
    tempMax: 20,
    tempMin: 10,
    precipSum: 0,
    precipProbMax: 50,
    precipHours: 0,
    uvMax: 6,
    sunrise: "",
    sunset: "",
    windMax: 0,
    windDir: 0,
  });

  it("replaces prior days but keeps today and the future on the forecast", () => {
    const forecast = [g("2026-08-01", 1), g("2026-08-02", 2), g("2026-08-03", 3)];
    const observed = [
      { ...g("2026-08-01", 61), uvMax: NaN },
      { ...g("2026-08-02", 63), uvMax: NaN },
    ];
    const out = mergeObservedDaily(forecast, observed, "2026-08-02"); // today = 08-02
    expect(out[0].code).toBe(61); // 08-01 prior → observed
    expect(Number.isNaN(out[0].uvMax)).toBe(true);
    expect(out[1].code).toBe(2); // 08-02 today → forecast kept (still partly future)
    expect(out[2].code).toBe(3); // 08-03 future → forecast kept
  });
});
