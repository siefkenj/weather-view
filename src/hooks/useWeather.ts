// Weather data hooks. These are thin adapters over the RTK Query endpoints in
// store/openMeteoApi.ts — they keep the old call sites (useForecast(place, opts))
// unchanged and re-add the one TanStack behaviour we relied on: keeping the last
// data on screen while a new fetch is in flight (`keepPreviousData`).

import { useEffect, useRef, useState } from "react";
import {
  placeKey,
  useAirQualityQuery,
  useArchiveQuery,
  useEnsembleQuery,
  useForecastQuery,
  useMinutelyQuery,
  useStationPrecipQuery,
} from "../store/openMeteoApi";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import { addDays, todayInZone } from "../utils/format";
import type { Place } from "../api/types";

/** How far into the past the full (stage-2) load reaches. */
export const FULL_PAST_DAYS = 20;

export interface ForecastOptions {
  forecastDays: number;
  pastDays: number;
  extraModels?: string[];
}

// Live-data refresh policy for the point queries (forecast, minutely, air quality):
// poll every 10 minutes — paused while the tab is backgrounded — and also refetch the
// instant the tab is refocused or the network reconnects, so returning to the app shows
// current data. These queries use a short cache window (LIVE_CACHE) so each of these
// refetches actually revalidates over the network. Requires setupListeners (store/index).
const POLL_MS = 10 * 60 * 1000;
const poll = {
  pollingInterval: POLL_MS,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
  refetchOnReconnect: true,
} as const;

/** Retain the last defined data while a refetch is in flight (parity with the old
 *  `placeholderData: keepPreviousData`). Nothing is retained while a query is
 *  skipped/idle, so disabled panels don't show stale data. */
function useKeepData<T>(data: T | undefined, isFetching: boolean): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (data !== undefined) ref.current = data;
  return data ?? (isFetching ? ref.current : undefined);
}

/** Debounce the chosen model set so ticking several boxes in the picker fires ONE
 *  consensus request for the final selection, not one per box. The initial value is
 *  applied immediately (so a shared consensus URL loads without delay); only later
 *  changes wait. Keyed on the joined ids to avoid array-identity churn. */
function useDebouncedModels(models: string[] | undefined, ms: number): string[] {
  const list = models ?? [];
  const key = list.join(",");
  const latest = useRef(list);
  latest.current = list;
  const [debounced, setDebounced] = useState(list);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(latest.current), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return debounced;
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
    { skip: !options.enabled, ...poll },
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

/** Observed (ERA5) history for the past window. Historical data is stable, so no
 *  polling; it revalidates only when the date range rolls over (see forceRefetch). */
export function useArchive(
  place: Place,
  options: { startDate: string; endDate: string; enabled: boolean },
) {
  const r = useArchiveQuery(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
      startDate: options.startDate,
      endDate: options.endDate,
    },
    { skip: !options.enabled },
  );
  return { ...r, data: useKeepData(r.data, r.isFetching) };
}

/** Measured rain-gauge precipitation for the past (ECCC nearest station; Canada only).
 *  Refetches daily as observations publish; empty elsewhere. Needs a real IANA `timezone`
 *  (to align the gauge's UTC stamps to the local grid) — the forecast response supplies
 *  it even when the Place from a URL slug doesn't. */
export function useStationPrecip(
  place: Place,
  options: { day: string; enabled: boolean; timezone?: string },
) {
  const r = useStationPrecipQuery(
    {
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: options.timezone ?? place.timezone,
      day: options.day,
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
  /** Models to blend into a consensus; empty = best_match (see utils/consensus). */
  extraModels?: string[];
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
  const extraModels = useDebouncedModels(options.extraModels, 350);
  const forecast = useForecast(place, { forecastDays, pastDays, extraModels });

  // Expand to the full range once the visible window has painted.
  useEffect(() => {
    if (!loadFull && forecast.data) setLoadFull(true);
  }, [loadFull, forecast.data]);

  // Observed history covering the same past window the forecast loads (stage 2). Only
  // fetched once the full range is loaded — the observed past isn't visible before then.
  // Prefer the forecast's resolved IANA zone (a Place from a URL slug may lack one).
  const zone = forecast.data?.timezone ?? place.timezone;
  const endDate = todayInZone(zone);
  const startDate = addDays(endDate, -FULL_PAST_DAYS);

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
    archive: useArchive(place, { startDate, endDate, enabled: loadFull }),
    stationPrecip: useStationPrecip(place, { day: endDate, enabled: loadFull, timezone: zone }),
  };
}
