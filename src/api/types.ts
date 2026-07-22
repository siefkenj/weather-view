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
  temperature_2m: number[];
  apparent_temperature: number[];
  dew_point_2m: number[];
  precipitation: number[];
  precipitation_probability: number[];
  relative_humidity_2m: number[];
  surface_pressure: number[];
  cloud_cover: number[];
  shortwave_radiation: number[];
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
