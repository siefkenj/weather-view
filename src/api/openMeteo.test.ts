import { describe, expect, it } from "vitest";
import {
  buildAirQualityUrl,
  buildArchiveUrl,
  buildEnsembleUrl,
  buildForecastUrl,
  buildGeocodeUrl,
  buildMinutelyUrl,
} from "./openMeteo";

describe("buildForecastUrl", () => {
  it("requests the best_match composite with sane defaults", () => {
    const url = new URL(buildForecastUrl({ latitude: 43.7, longitude: -79.4 }));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("models")).toBe("best_match");
    expect(url.searchParams.get("forecast_days")).toBe("16");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("hourly")).toContain("temperature_2m");
    expect(url.searchParams.get("hourly")).toContain("dew_point_2m");
    // Needed to derive the consensus "current" condition (see utils/consensus).
    expect(url.searchParams.get("hourly")).toContain("weather_code");
    expect(url.searchParams.get("daily")).toContain("weather_code");
  });

  it("requests exactly the selected models (best_match is not mixed into a blend)", () => {
    const one = new URL(buildForecastUrl({ latitude: 0, longitude: 0, extraModels: ["jma_seamless"] }));
    expect(one.searchParams.get("models")).toBe("jma_seamless");

    const many = new URL(
      buildForecastUrl({ latitude: 0, longitude: 0, extraModels: ["ecmwf_ifs025", "gfs_seamless"] }),
    );
    expect(many.searchParams.get("models")).toBe("ecmwf_ifs025,gfs_seamless");
  });

  it("falls back to best_match when the selection is empty", () => {
    const url = new URL(buildForecastUrl({ latitude: 0, longitude: 0, extraModels: [] }));
    expect(url.searchParams.get("models")).toBe("best_match");
  });
});

describe("buildEnsembleUrl", () => {
  it("targets the ensemble endpoint with the default model", () => {
    const url = new URL(buildEnsembleUrl({ latitude: 1, longitude: 2 }));
    expect(url.hostname).toBe("ensemble-api.open-meteo.com");
    expect(url.searchParams.get("models")).toBe("ecmwf_ifs025");
    expect(url.searchParams.get("hourly")).toBe("temperature_2m,precipitation");
  });
});

describe("buildArchiveUrl", () => {
  it("targets the archive with a date range, observed-only vars, and matching units", () => {
    const url = new URL(
      buildArchiveUrl({
        latitude: 43.7,
        longitude: -79.4,
        startDate: "2026-07-14",
        endDate: "2026-08-03",
        timezone: "America/Toronto",
      }),
    );
    expect(url.hostname).toBe("archive-api.open-meteo.com");
    expect(url.searchParams.get("start_date")).toBe("2026-07-14");
    expect(url.searchParams.get("end_date")).toBe("2026-08-03");
    expect(url.searchParams.get("past_days")).toBeNull();
    expect(url.searchParams.get("timezone")).toBe("America/Toronto");
    // Units must mirror the forecast so the past splices cleanly.
    expect(url.searchParams.get("precipitation_unit")).toBe("mm");
    expect(url.searchParams.get("windspeed_unit")).toBe("kmh");
    expect(url.searchParams.get("temperature_unit")).toBe("celsius");
    // Observed-only: no probability (hourly), no hourly weather_code.
    const hourly = url.searchParams.get("hourly")!;
    expect(hourly).toContain("temperature_2m");
    expect(hourly).toContain("wind_direction_10m");
    expect(hourly).not.toContain("precipitation_probability");
    expect(hourly).not.toContain("weather_code");
    // Daily keeps weather_code but drops the un-observable maxes.
    const daily = url.searchParams.get("daily")!;
    expect(daily).toContain("weather_code");
    expect(daily).not.toContain("uv_index_max");
    expect(daily).not.toContain("precipitation_probability_max");
  });
});

describe("buildAirQualityUrl", () => {
  it("caps forecast_days at 7 and includes AQI variables", () => {
    const url = new URL(buildAirQualityUrl({ latitude: 1, longitude: 2, forecastDays: 16 }));
    expect(url.hostname).toBe("air-quality-api.open-meteo.com");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("hourly")).toContain("us_aqi");
    expect(url.searchParams.get("hourly")).toContain("pm2_5");
  });
});

describe("buildMinutelyUrl", () => {
  it("requests a small near-term 15-minute window", () => {
    const url = new URL(buildMinutelyUrl({ latitude: 43.7, longitude: -79.4 }));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("minutely_15")).toContain("temperature_2m");
    expect(url.searchParams.get("minutely_15")).toContain("precipitation");
    expect(url.searchParams.get("forecast_days")).toBe("3");
    expect(url.searchParams.get("past_days")).toBe("2");
    expect(url.searchParams.get("hourly")).toBeNull();
  });
});

describe("buildGeocodeUrl", () => {
  it("encodes the search name", () => {
    const url = new URL(buildGeocodeUrl("New York"));
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("New York");
  });
});
