// Weather data hooks. These are thin adapters over the RTK Query endpoints in
// store/openMeteoApi.ts — they keep the old call sites (useForecast(place, opts))
// unchanged and re-add the one TanStack behaviour we relied on: keeping the last
// data on screen while a new fetch is in flight (`keepPreviousData`).

import { useEffect, useRef, useState } from "react";
import {
  placeKey,
  useAirQualityQuery,
  useEnsembleQuery,
  useForecastQuery,
  useMinutelyQuery,
} from "../store/openMeteoApi";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import type { Place } from "../api/types";

/** How far into the past the full (stage-2) load reaches. */
export const FULL_PAST_DAYS = 20;

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

interface LocationOptions {
  ci?: boolean;
  air?: boolean;
  /** Days to fetch forward/back on the FIRST (fast) load — the visible window. */
  initialForecastDays?: number;
  initialPastDays?: number;
}

/**
 * All weather for one location, grouped as sub-objects under its `lon,lat` key.
 * The cache stays normalized per source (each field is an independent RTK Query
 * result with its own data/loading/error/refetch); this hook is just the grouped
 * *read* view. `ci` and `air` gate the two optional (skippable) sources.
 *
 * Forecast loading is **staged**: the first request covers just the visible window
 * (current day + the other visible days) for a fast first paint, then — once that
 * lands — the range expands to the whole forecast + {@link FULL_PAST_DAYS} of past
 * days in the background. The endpoint is location-keyed and refetches into the same
 * entry when the range grows (forceRefetch), and `useForecast` keeps the stage-1
 * data on screen until the full range arrives.
 */
export function useLocationWeather(place: Place, options: LocationOptions = {}) {
  const [loadFull, setLoadFull] = useState(false);
  const forecastDays = loadFull
    ? MAX_FORECAST_DAYS
    : Math.min(MAX_FORECAST_DAYS, options.initialForecastDays ?? MAX_FORECAST_DAYS);
  const pastDays = loadFull ? FULL_PAST_DAYS : Math.min(FULL_PAST_DAYS, options.initialPastDays ?? 0);
  const forecast = useForecast(place, { forecastDays, pastDays });

  // Expand to the full range once the visible window has painted.
  useEffect(() => {
    if (!loadFull && forecast.data) setLoadFull(true);
  }, [loadFull, forecast.data]);

  return {
    key: placeKey({ latitude: place.latitude, longitude: place.longitude }),
    forecast,
    minutely: useMinutely(place),
    ensemble: useEnsemble(place, { forecastDays: MAX_FORECAST_DAYS, enabled: !!options.ci }),
    airQuality: useAirQuality(place, {
      forecastDays: AIR_FORECAST_DAYS,
      pastDays: FULL_PAST_DAYS,
      enabled: !!options.air,
    }),
  };
}
