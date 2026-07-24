// Weather data hooks. These are thin adapters over the RTK Query endpoints in
// store/openMeteoApi.ts — they keep the old call sites (useForecast(place, opts))
// unchanged and re-add the one TanStack behaviour we relied on: keeping the last
// data on screen while a new fetch is in flight (`keepPreviousData`).

import { useRef } from "react";
import {
  placeKey,
  useAirQualityQuery,
  useEnsembleQuery,
  useForecastQuery,
  useMinutelyQuery,
} from "../store/openMeteoApi";
import { MAX_FORECAST_DAYS, MAX_PAST_DAYS } from "../api/openMeteo";
import type { Place } from "../api/types";

export interface ForecastOptions {
  forecastDays: number;
  pastDays: number;
  extraModels?: string[];
}

// Refresh the near-term data (and with it the "now" marker + current readings)
// every 10 minutes, but not while the tab is in the background.
const POLL_MS = 10 * 60 * 1000;
const poll = { pollingInterval: POLL_MS, skipPollingIfUnfocused: true } as const;

/** Retain the last defined data while a refetch is in flight (parity with the old
 *  `placeholderData: keepPreviousData`). Nothing is retained while a query is
 *  skipped/idle, so disabled panels don't show stale data. */
function useKeepData<T>(data: T | undefined, isFetching: boolean): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (data !== undefined) ref.current = data;
  return data ?? (isFetching ? ref.current : undefined);
}

export function useForecast(place: Place, options: ForecastOptions) {
  const r = useForecastQuery(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
      forecastDays: options.forecastDays,
      pastDays: options.pastDays,
      extraModels: options.extraModels,
    },
    poll,
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

export function useMinutely(place: Place, options: { enabled?: boolean } = {}) {
  const r = useMinutelyQuery(
    { latitude: place.latitude, longitude: place.longitude, timezone: place.timezone },
    { skip: options.enabled === false, ...poll },
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

export function useEnsemble(place: Place, options: { forecastDays: number; enabled: boolean }) {
  const r = useEnsembleQuery(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
      forecastDays: options.forecastDays,
    },
    { skip: !options.enabled },
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

export function useAirQuality(
  place: Place,
  options: { forecastDays: number; pastDays: number; enabled: boolean },
) {
  const r = useAirQualityQuery(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
      forecastDays: options.forecastDays,
      pastDays: options.pastDays,
    },
    { skip: !options.enabled },
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

/** Air quality reaches ~7 days out on Open-Meteo. */
const AIR_FORECAST_DAYS = 7;

/**
 * All weather for one location, grouped as sub-objects under its `lon,lat` key.
 * The cache stays normalized per source (each field is an independent RTK Query
 * result with its own data/loading/error/refetch); this hook is just the grouped
 * *read* view. `ci` and `air` gate the two optional (skippable) sources.
 */
export function useLocationWeather(place: Place, options: { ci?: boolean; air?: boolean } = {}) {
  return {
    key: placeKey({ latitude: place.latitude, longitude: place.longitude }),
    forecast: useForecast(place, { forecastDays: MAX_FORECAST_DAYS, pastDays: MAX_PAST_DAYS }),
    minutely: useMinutely(place),
    ensemble: useEnsemble(place, { forecastDays: MAX_FORECAST_DAYS, enabled: !!options.ci }),
    airQuality: useAirQuality(place, {
      forecastDays: AIR_FORECAST_DAYS,
      pastDays: MAX_PAST_DAYS,
      enabled: !!options.air,
    }),
  };
}
