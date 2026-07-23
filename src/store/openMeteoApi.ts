// RTK Query API for the Open-Meteo family. We keep the existing typed fetchers /
// URL builders in api/openMeteo.ts and drive them through `queryFn` (with
// fakeBaseQuery), so all the request shaping and error parsing is reused and the
// AbortSignal still cancels in-flight requests.
//
// Keying is standardized: EVERY weather endpoint caches one entry per location,
// keyed by a single `lon,lat` string (see `placeKey` + `byLocation`), so the store
// reads uniformly as `openMeteoApi.queries['<endpoint>(lon,lat)']` regardless of
// source. The per-source separation (forecast / minutely / ensemble / airQuality)
// is deliberate — see the note below — and the grouped, per-location view is
// assembled at read time by useLocationWeather (hooks/useWeather.ts).
//
// Why one entry PER SOURCE rather than a single time-indexed blob per location:
// the sources have different resolutions and horizons (hourly over ~108 days vs
// 15-min over ~5 days vs a 7-day air-quality cap vs a 51-member ensemble), they
// load and fail independently, and the ensemble is a distribution, not a scalar
// per timestamp. So we normalize the cache by source and join by time only over
// the visible window, at the point of use (Dashboard's window alignment).
//
// With an eye on two planned features:
//   • Multiple locations at once — different coordinates → different `lon,lat`
//     keys → independent entries. Comparing places is just calling the hooks per
//     place; nothing here changes.
//   • Progressive loading (one day first, then the rest) — the range lives OUTSIDE
//     the key, and ranged endpoints refetch when it changes (forceRefetch). Today
//     we fetch the full range in one shot. When we add day-first loading, this is
//     the seam: add a `merge` that stitches an incoming range into the existing
//     entry by timestamp instead of replacing it.

import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  fetchAirQuality,
  fetchEnsemble,
  fetchForecast,
  fetchGeocode,
  fetchMinutely,
} from "../api/openMeteo";
import type {
  AirQualityResponse,
  EnsembleResponse,
  ForecastResponse,
  GeocodingResponse,
  MinutelyResponse,
} from "../api/types";

export interface PlaceArg {
  latitude: number;
  longitude: number;
  timezone?: string;
}
export interface ForecastArg extends PlaceArg {
  forecastDays: number;
  pastDays: number;
  extraModels?: string[];
}
export interface EnsembleArg extends PlaceArg {
  forecastDays: number;
}
export interface AirQualityArg extends PlaceArg {
  forecastDays: number;
  pastDays: number;
}

export interface QueryError {
  message: string;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
/** Stable identity for a location: a single `lon,lat` string (GeoJSON order),
 *  shared by every endpoint and across time ranges. */
export const placeKey = (p: PlaceArg) => `${round(p.longitude)},${round(p.latitude)}`;

/** serializeQueryArgs that keys a weather endpoint's cache entry on location only. */
const byLocation =
  <A extends PlaceArg>() =>
  ({ queryArgs, endpointName }: { queryArgs: A; endpointName: string }) =>
    `${endpointName}(${placeKey(queryArgs)})`;

/** forceRefetch that re-fetches into the (location-keyed) entry when the requested
 *  time range changes — the seam for future progressive/day-first loading. */
const refetchOnRange =
  <A>(rangeKey: (a: A) => string) =>
  ({ currentArg, previousArg }: { currentArg?: A; previousArg?: A }) =>
    !previousArg || !currentArg || rangeKey(currentArg) !== rangeKey(previousArg);

/** Run a fetcher once, retrying a single time on transient failure (parity with
 *  the old QueryClient `retry: 1`). Returns the RTK Query {data} | {error} shape. */
async function run<T>(fn: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  try {
    return { data: await fn(signal) };
  } catch (first) {
    if (signal?.aborted) return { error: toError(first) };
    try {
      return { data: await fn(signal) };
    } catch (second) {
      return { error: toError(second) };
    }
  }
}

const toError = (e: unknown): QueryError => ({
  message: e instanceof Error ? e.message : String(e),
});

export const openMeteoApi = createApi({
  reducerPath: "openMeteoApi",
  baseQuery: fakeBaseQuery<QueryError>(),
  keepUnusedDataFor: 30 * 60, // 30 min, matching the old gcTime
  endpoints: (build) => ({
    forecast: build.query<ForecastResponse, ForecastArg>({
      queryFn: (arg, api) =>
        run(
          (signal) =>
            fetchForecast(
              {
                latitude: arg.latitude,
                longitude: arg.longitude,
                timezone: arg.timezone,
                forecastDays: arg.forecastDays,
                pastDays: arg.pastDays,
                extraModels: arg.extraModels,
              },
              signal,
            ),
          api.signal,
        ),
      // Keyed on location; range lives outside the key (see file header).
      serializeQueryArgs: byLocation<ForecastArg>(),
      forceRefetch: refetchOnRange(
        (a: ForecastArg) => `${a.forecastDays}:${a.pastDays}:${(a.extraModels ?? []).join(",")}`,
      ),
    }),
    minutely: build.query<MinutelyResponse, PlaceArg>({
      queryFn: (arg, api) =>
        run(
          (signal) =>
            fetchMinutely(
              { latitude: arg.latitude, longitude: arg.longitude, timezone: arg.timezone },
              signal,
            ),
          api.signal,
        ),
      serializeQueryArgs: byLocation<PlaceArg>(), // no range → location fully keys it
    }),
    ensemble: build.query<EnsembleResponse, EnsembleArg>({
      queryFn: (arg, api) =>
        run(
          (signal) =>
            fetchEnsemble(
              {
                latitude: arg.latitude,
                longitude: arg.longitude,
                timezone: arg.timezone,
                forecastDays: arg.forecastDays,
              },
              signal,
            ),
          api.signal,
        ),
      serializeQueryArgs: byLocation<EnsembleArg>(),
      forceRefetch: refetchOnRange((a: EnsembleArg) => `${a.forecastDays}`),
    }),
    airQuality: build.query<AirQualityResponse, AirQualityArg>({
      queryFn: (arg, api) =>
        run(
          (signal) =>
            fetchAirQuality(
              {
                latitude: arg.latitude,
                longitude: arg.longitude,
                timezone: arg.timezone,
                forecastDays: arg.forecastDays,
                pastDays: arg.pastDays,
              },
              signal,
            ),
          api.signal,
        ),
      serializeQueryArgs: byLocation<AirQualityArg>(),
      forceRefetch: refetchOnRange((a: AirQualityArg) => `${a.forecastDays}:${a.pastDays}`),
    }),
    geocode: build.query<GeocodingResponse, string>({
      queryFn: (name, api) => run((signal) => fetchGeocode(name, signal), api.signal),
      keepUnusedDataFor: 24 * 60 * 60, // geocoding rarely changes
    }),
  }),
});

export const {
  useForecastQuery,
  useMinutelyQuery,
  useEnsembleQuery,
  useAirQualityQuery,
  useGeocodeQuery,
} = openMeteoApi;
