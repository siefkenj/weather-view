// Typed fetchers + URL builders for the Open-Meteo API family.
// No API key required; every endpoint sends permissive CORS headers, so these
// run directly from the browser on GitHub Pages with no proxy.

import type {
  AirQualityResponse,
  EnsembleResponse,
  ForecastResponse,
  GeocodingResponse,
} from "./types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export const MAX_FORECAST_DAYS = 16;
export const MAX_PAST_DAYS = 92;
/** Global ensemble with the most members (51) for stable percentile bands. */
export const ENSEMBLE_MODEL = "ecmwf_ifs025";

export const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "dew_point_2m",
  "precipitation",
  "precipitation_probability",
  "relative_humidity_2m",
  "surface_pressure",
  "cloud_cover",
  "shortwave_radiation",
] as const;

export const DAILY_VARS = [
  "weather_code",
  "sunrise",
  "sunset",
  "uv_index_max",
  "precipitation_hours",
  "precipitation_probability_max",
  "precipitation_sum",
  "temperature_2m_max",
  "temperature_2m_min",
] as const;

export const CURRENT_VARS = ["temperature_2m", "apparent_temperature", "weather_code"] as const;

export const AIR_QUALITY_VARS = [
  "pm2_5",
  "pm10",
  "ozone",
  "nitrogen_dioxide",
  "sulphur_dioxide",
  "carbon_monoxide",
  "us_aqi",
  "european_aqi",
  "uv_index",
] as const;

function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { reason?: string };
      if (body?.reason) reason = body.reason;
    } catch {
      // response was not JSON; keep the status text
    }
    throw new Error(`Open-Meteo request failed: ${reason}`);
  }
  return (await res.json()) as T;
}

export interface ForecastParams {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
  timezone?: string;
  /** Extra models to overlay alongside best_match, e.g. ["jma_seamless"]. */
  extraModels?: string[];
}

export function buildForecastUrl(params: ForecastParams): string {
  const models = ["best_match", ...(params.extraModels ?? [])];
  return buildUrl(FORECAST_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: HOURLY_VARS.join(","),
    daily: DAILY_VARS.join(","),
    current: CURRENT_VARS.join(","),
    timezone: params.timezone ?? "auto",
    forecast_days: params.forecastDays ?? MAX_FORECAST_DAYS,
    past_days: params.pastDays ?? 0,
    models: models.length > 1 ? models.join(",") : "best_match",
    windspeed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });
}

export function fetchForecast(params: ForecastParams, signal?: AbortSignal): Promise<ForecastResponse> {
  return fetchJson<ForecastResponse>(buildForecastUrl(params), signal);
}

export interface EnsembleParams {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
  timezone?: string;
  model?: string;
}

export function buildEnsembleUrl(params: EnsembleParams): string {
  return buildUrl(ENSEMBLE_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: "temperature_2m,precipitation",
    timezone: params.timezone ?? "auto",
    forecast_days: params.forecastDays ?? MAX_FORECAST_DAYS,
    past_days: params.pastDays ?? 0,
    models: params.model ?? ENSEMBLE_MODEL,
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
}

export function fetchEnsemble(params: EnsembleParams, signal?: AbortSignal): Promise<EnsembleResponse> {
  return fetchJson<EnsembleResponse>(buildEnsembleUrl(params), signal);
}

export interface AirQualityParams {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
  timezone?: string;
}

export function buildAirQualityUrl(params: AirQualityParams): string {
  return buildUrl(AIR_QUALITY_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: AIR_QUALITY_VARS.join(","),
    timezone: params.timezone ?? "auto",
    forecast_days: Math.min(params.forecastDays ?? 5, 7),
    past_days: params.pastDays ?? 0,
  });
}

export function fetchAirQuality(
  params: AirQualityParams,
  signal?: AbortSignal,
): Promise<AirQualityResponse> {
  return fetchJson<AirQualityResponse>(buildAirQualityUrl(params), signal);
}

export function buildGeocodeUrl(name: string, count = 8): string {
  return buildUrl(GEOCODING_URL, { name, count, language: "en", format: "json" });
}

export function fetchGeocode(name: string, signal?: AbortSignal): Promise<GeocodingResponse> {
  return fetchJson<GeocodingResponse>(buildGeocodeUrl(name), signal);
}
