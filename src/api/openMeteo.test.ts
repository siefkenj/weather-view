import { describe, expect, it } from "vitest";
import {
  buildAirQualityUrl,
  buildEnsembleUrl,
  buildForecastUrl,
  buildGeocodeUrl,
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
    expect(url.searchParams.get("daily")).toContain("weather_code");
  });

  it("joins extra models alongside best_match", () => {
    const url = new URL(
      buildForecastUrl({ latitude: 0, longitude: 0, extraModels: ["jma_seamless"] }),
    );
    expect(url.searchParams.get("models")).toBe("best_match,jma_seamless");
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

describe("buildAirQualityUrl", () => {
  it("caps forecast_days at 7 and includes AQI variables", () => {
    const url = new URL(buildAirQualityUrl({ latitude: 1, longitude: 2, forecastDays: 16 }));
    expect(url.hostname).toBe("air-quality-api.open-meteo.com");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("hourly")).toContain("us_aqi");
    expect(url.searchParams.get("hourly")).toContain("pm2_5");
  });
});

describe("buildGeocodeUrl", () => {
  it("encodes the search name", () => {
    const url = new URL(buildGeocodeUrl("New York"));
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("New York");
  });
});
