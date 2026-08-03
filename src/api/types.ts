// Shared types for the Open-Meteo API responses we consume.
// Docs: https://open-meteo.com/en/docs

export interface GeoLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
  population?: number;
  feature_code?: string;
}

export interface GeocodingResponse {
  results?: GeoLocation[];
  generationtime_ms: number;
}

/** A resolved place used to drive every weather query. */
export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
}

export interface ForecastCurrent {
  time: string;
  interval: number;
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
}

export interface ForecastHourly {
  time: string[];
  /** Present because we request it (needed to derive the consensus "current"
   *  condition); not surfaced through HourlyPoint, so optional here. */
  weather_code?: number[];
  temperature_2m: number[];
  apparent_temperature: number[];
  dew_point_2m: number[];
  precipitation: number[];
  precipitation_probability: number[];
  relative_humidity_2m: number[];
  surface_pressure: number[];
  cloud_cover: number[];
  shortwave_radiation: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
}

export interface ForecastDaily {
  time: string[];
  weather_code: number[];
  sunrise: string[];
  sunset: string[];
  uv_index_max: number[];
  precipitation_hours: number[];
  precipitation_probability_max: number[];
  precipitation_sum: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  wind_speed_10m_max: number[];
  wind_direction_10m_dominant: number[];
}

/** How the multi-model consensus for TODAY was reached, attached to a consensus
 *  forecast so the UI can explain it ("6 of 9 models show a wet day"). Matches the
 *  headline, which summarizes the whole day. Absent on a single-model response. */
export interface ConsensusMeta {
  /** Open-Meteo model ids that went into the consensus. */
  models: string[];
  /** Whether the consensus verdict for today is precipitation vs dry. */
  wet: boolean;
  /** Models agreeing with the wet/dry verdict for today. */
  agree: number;
  /** Models that reported a daily code for today (the vote's denominator). */
  total: number;
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  elevation: number;
  current_units: Record<string, string>;
  current: ForecastCurrent;
  hourly_units: Record<string, string>;
  hourly: ForecastHourly;
  daily_units: Record<string, string>;
  daily: ForecastDaily;
  /** Set only when this response is the blend of ≥2 models (see utils/consensus). */
  consensus?: ConsensusMeta;
}

/** Observed (ERA5 reanalysis) history from the archive API. Same block shapes as the
 *  forecast, minus the fields that aren't observable: `precipitation_probability`
 *  (hourly) and `precipitation_probability_max` / `uv_index_max` (daily). `null`
 *  appears where a value isn't available yet (typically the most recent hour or two). */
export interface ArchiveHourly {
  time: string[];
  temperature_2m: (number | null)[];
  apparent_temperature: (number | null)[];
  dew_point_2m: (number | null)[];
  precipitation: (number | null)[];
  relative_humidity_2m: (number | null)[];
  surface_pressure: (number | null)[];
  cloud_cover: (number | null)[];
  shortwave_radiation: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
}

export interface ArchiveDaily {
  time: string[];
  weather_code: (number | null)[];
  sunrise: string[];
  sunset: string[];
  precipitation_hours: (number | null)[];
  precipitation_sum: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  wind_speed_10m_max: (number | null)[];
  wind_direction_10m_dominant: (number | null)[];
}

export interface ArchiveResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds: number;
  hourly_units: Record<string, string>;
  hourly: ArchiveHourly;
  daily_units: Record<string, string>;
  daily: ArchiveDaily;
}

/** 15-minute block (native only where a high-res model — e.g. NOAA HRRR over
 *  North America — covers the point; interpolated from hourly elsewhere). */
export interface Minutely15 {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation: number[];
}

export interface MinutelyResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds: number;
  minutely_15_units: Record<string, string>;
  minutely_15: Minutely15;
}

export interface AirQualityHourly {
  time: string[];
  pm2_5: number[];
  pm10: number[];
  ozone: number[];
  nitrogen_dioxide: number[];
  sulphur_dioxide: number[];
  carbon_monoxide: number[];
  us_aqi: number[];
  european_aqi: number[];
  uv_index: number[];
}

export interface AirQualityResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds: number;
  hourly_units: Record<string, string>;
  hourly: AirQualityHourly;
}

/** Ensemble hourly is an open record: `time` plus `<var>` and `<var>_memberNN`. */
export interface EnsembleResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset_seconds: number;
  hourly_units: Record<string, string>;
  hourly: { time: string[] } & Record<string, number[] | string[]>;
}
