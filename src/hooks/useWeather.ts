// TanStack Query hooks over the Open-Meteo fetchers.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchAirQuality,
  fetchEnsemble,
  fetchForecast,
  type ForecastParams,
} from "../api/openMeteo";
import type { Place } from "../api/types";

const round = (n: number) => Math.round(n * 10000) / 10000;
const coordKey = (place: Place) => `${round(place.latitude)},${round(place.longitude)}`;

const TEN_MINUTES = 10 * 60 * 1000;

export interface ForecastOptions {
  forecastDays: number;
  pastDays: number;
  extraModels?: string[];
}

export function useForecast(place: Place, options: ForecastOptions) {
  const params: ForecastParams = {
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
    forecastDays: options.forecastDays,
    pastDays: options.pastDays,
    extraModels: options.extraModels,
  };
  return useQuery({
    queryKey: [
      "forecast",
      coordKey(place),
      options.forecastDays,
      options.pastDays,
      (options.extraModels ?? []).join(","),
    ],
    queryFn: ({ signal }) => fetchForecast(params, signal),
    staleTime: TEN_MINUTES,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useEnsemble(
  place: Place,
  options: { forecastDays: number; enabled: boolean },
) {
  return useQuery({
    queryKey: ["ensemble", coordKey(place), options.forecastDays],
    queryFn: ({ signal }) =>
      fetchEnsemble(
        {
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: place.timezone,
          forecastDays: options.forecastDays,
        },
        signal,
      ),
    enabled: options.enabled,
    staleTime: TEN_MINUTES,
    placeholderData: keepPreviousData,
  });
}

export function useAirQuality(
  place: Place,
  options: { forecastDays: number; pastDays: number; enabled: boolean },
) {
  return useQuery({
    queryKey: ["air-quality", coordKey(place), options.forecastDays, options.pastDays],
    queryFn: ({ signal }) =>
      fetchAirQuality(
        {
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: place.timezone,
          forecastDays: options.forecastDays,
          pastDays: options.pastDays,
        },
        signal,
      ),
    enabled: options.enabled,
    staleTime: TEN_MINUTES,
    placeholderData: keepPreviousData,
  });
}
