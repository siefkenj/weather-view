// Typed fetchers + URL builders for the Open-Meteo API family.
// No API key required; every endpoint sends permissive CORS headers, so these
// run directly from the browser on GitHub Pages with no proxy.

import { fetchJson } from "./http";
import { buildConsensus, type RawMultiForecast } from "../utils/consensus";
import type {
  AirQualityResponse,
  ArchiveResponse,
  EnsembleResponse,
  ForecastResponse,
  GeocodingResponse,
  MinutelyResponse,
} from "./types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export const MAX_FORECAST_DAYS = 16;
export const MAX_PAST_DAYS = 92;
/** Global ensemble with the most members (51) for stable percentile bands. */
export const ENSEMBLE_MODEL = "ecmwf_ifs025";

export const HOURLY_VARS = [
  "weather_code",
  "temperature_2m",
  "apparent_temperature",
  "dew_point_2m",
  "precipitation",
  "precipitation_probability",
  "relative_humidity_2m",
  "surface_pressure",
  "cloud_cover",
  "shortwave_radiation",
  "wind_speed_10m",
  "wind_direction_10m",
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
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "relative_humidity_2m_mean",
] as const;

export const CURRENT_VARS = ["temperature_2m", "apparent_temperature", "weather_code"] as const;

// 15-minute variables. Only temperature/apparent/precipitation are available at
// this cadence (surface_pressure, cloud_cover, precipitation_probability are not),
// and native sub-hourly data reaches ~48 h out (NOAA HRRR over North America).
export const MINUTELY_VARS = ["temperature_2m", "apparent_temperature", "precipitation"] as const;

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

// The observed (archive/ERA5) variables — the forecast vars minus the ones that
// aren't observable: `precipitation_probability` (a probability is a forecast, not a
// measurement) and `weather_code` (not consumed at hourly resolution). Derived so
// they track HOURLY_VARS/DAILY_VARS automatically.
export const ARCHIVE_HOURLY_VARS = HOURLY_VARS.filter(
  (v) => v !== "weather_code" && v !== "precipitation_probability",
);
// Daily observed vars: drop `precipitation_probability_max` (probability) and
// `uv_index_max` (ERA5 archive doesn't carry it).
export const ARCHIVE_DAILY_VARS = DAILY_VARS.filter(
  (v) => v !== "precipitation_probability_max" && v !== "uv_index_max",
);

function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export interface ForecastParams {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
  timezone?: string;
  /**
   * The models to blend into a consensus (see utils/consensus). Empty → `best_match`,
   * Open-Meteo's automatic pick. One → that model alone. Two or more → the response
   * is multi-model (suffixed columns) and {@link fetchForecast} reduces it to a
   * consensus. `best_match` is intentionally not mixed in — it's a meta-model that
   * would double-count whichever real model it adopted.
   */
  extraModels?: string[];
}

/** The models actually requested for a set of picker selections. */
function requestModels(extraModels?: string[]): string[] {
  const selected = (extraModels ?? []).filter(Boolean);
  return selected.length ? selected : ["best_match"];
}

export function buildForecastUrl(params: ForecastParams): string {
  return buildUrl(FORECAST_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: HOURLY_VARS.join(","),
    daily: DAILY_VARS.join(","),
    current: CURRENT_VARS.join(","),
    timezone: params.timezone ?? "auto",
    forecast_days: params.forecastDays ?? MAX_FORECAST_DAYS,
    past_days: params.pastDays ?? 0,
    models: requestModels(params.extraModels).join(","),
    windspeed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });
}

// Live point data (forecast / minutely / air-quality panel) must actually revalidate on
// its 10-minute poll and on tab-refocus (hooks/useWeather.ts), so its localStorage entry
// is treated as fresh only briefly — long enough to serve instant reloads and dedupe
// near-simultaneous requests, but well under the poll interval so every poll hits the
// network. The map grids and the ensemble stay on the hourly cache (cache: true): they're
// large / slow-moving and lower-priority, fine to serve from the same-hour cache.
const LIVE_CACHE = { maxAgeMs: 2 * 60 * 1000 } as const; // 2 min

export async function fetchForecast(
  params: ForecastParams,
  signal?: AbortSignal,
): Promise<ForecastResponse> {
  const url = buildForecastUrl(params);
  // With ≥2 models Open-Meteo returns per-model suffixed columns; blend them into a
  // single consensus response so everything downstream stays model-agnostic. One
  // model (or best_match) comes back in the normal single-model shape already.
  if (requestModels(params.extraModels).length >= 2) {
    const raw = await fetchJson<RawMultiForecast>(url, { label: "forecast", signal, cache: LIVE_CACHE });
    return buildConsensus(raw, requestModels(params.extraModels));
  }
  return fetchJson<ForecastResponse>(url, { label: "forecast", signal, cache: LIVE_CACHE });
}

export interface MinutelyParams {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  pastDays?: number;
  timezone?: string;
}

// A small near-term 15-minute window: enough to cover the mini "today" graph
// (one calendar day) plus a zoomed-in ±day or two of the meteogram. Kept light on purpose.
export function buildMinutelyUrl(params: MinutelyParams): string {
  return buildUrl(FORECAST_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    minutely_15: MINUTELY_VARS.join(","),
    timezone: params.timezone ?? "auto",
    forecast_days: params.forecastDays ?? 3,
    past_days: params.pastDays ?? 2,
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
}

export function fetchMinutely(params: MinutelyParams, signal?: AbortSignal): Promise<MinutelyResponse> {
  return fetchJson<MinutelyResponse>(buildMinutelyUrl(params), {
    label: "minutely",
    signal,
    cache: LIVE_CACHE,
  });
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
  return fetchJson<EnsembleResponse>(buildEnsembleUrl(params), { label: "ensemble", signal, cache: true });
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
  return fetchJson<AirQualityResponse>(buildAirQualityUrl(params), {
    label: "air quality",
    signal,
    cache: LIVE_CACHE,
  });
}

export interface ArchiveParams {
  latitude: number;
  longitude: number;
  /** Inclusive local dates "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  timezone?: string;
}

// Observed history (ERA5 reanalysis). Uses start_date/end_date rather than past_days,
// and MUST mirror buildForecastUrl's timezone + unit params so the returned grid and
// units line up with the forecast for a clean splice at "now" (see utils/observed).
export function buildArchiveUrl(params: ArchiveParams): string {
  return buildUrl(ARCHIVE_URL, {
    latitude: params.latitude,
    longitude: params.longitude,
    hourly: ARCHIVE_HOURLY_VARS.join(","),
    daily: ARCHIVE_DAILY_VARS.join(","),
    timezone: params.timezone ?? "auto",
    start_date: params.startDate,
    end_date: params.endDate,
    windspeed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });
}

export function fetchArchive(params: ArchiveParams, signal?: AbortSignal): Promise<ArchiveResponse> {
  // Historical data is stable — fine to serve from the same-hour cache.
  return fetchJson<ArchiveResponse>(buildArchiveUrl(params), { label: "archive", signal, cache: true });
}

export function buildGeocodeUrl(name: string, count = 100): string {
  return buildUrl(GEOCODING_URL, { name, count, language: "en", format: "json" });
}

export function fetchGeocode(name: string, signal?: AbortSignal): Promise<GeocodingResponse> {
  // Not cached: it's per-keystroke and RTK Query already keeps results for a day.
  // A generous count so a space-qualified query (e.g. "London Ontario") can be filtered
  // down client-side — the geocoder itself only matches the place name (see useGeocode).
  return fetchJson<GeocodingResponse>(buildGeocodeUrl(name), { label: "search", signal });
}
