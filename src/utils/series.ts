// Reshape the forecast response into the windows the chart and daily strip use.

import type { ForecastResponse } from "../api/types";
import { dayKey } from "./format";

export interface HourlyPoint {
  time: string[];
  temperature: number[];
  apparent: number[];
  dewPoint: number[];
  precipitation: number[];
  precipProbability: number[];
  humidity: number[];
  cloudCover: number[];
  pressure: number[];
  radiation: number[];
}

export interface DailySummary {
  date: string;
  code: number;
  tempMax: number;
  tempMin: number;
  precipSum: number;
  precipProbMax: number;
  precipHours: number;
  uvMax: number;
  sunrise: string;
  sunset: string;
}

/** Pull the hourly block into named arrays (full past+future range). */
export function extractHourly(resp: ForecastResponse): HourlyPoint {
  const h = resp.hourly;
  return {
    time: h.time,
    temperature: h.temperature_2m,
    apparent: h.apparent_temperature,
    dewPoint: h.dew_point_2m,
    precipitation: h.precipitation,
    precipProbability: h.precipitation_probability,
    humidity: h.relative_humidity_2m,
    cloudCover: h.cloud_cover,
    pressure: h.surface_pressure,
    radiation: h.shortwave_radiation,
  };
}

function sliceHourly(h: HourlyPoint, start: number, end: number): HourlyPoint {
  const s = <T>(a: T[]) => a.slice(start, end);
  return {
    time: s(h.time),
    temperature: s(h.temperature),
    apparent: s(h.apparent),
    dewPoint: s(h.dewPoint),
    precipitation: s(h.precipitation),
    precipProbability: s(h.precipProbability),
    humidity: s(h.humidity),
    cloudCover: s(h.cloudCover),
    pressure: s(h.pressure),
    radiation: s(h.radiation),
  };
}

/** The distinct local day keys (YYYY-MM-DD) present in the block, in order. */
export function dayList(h: HourlyPoint): string[] {
  const days: string[] = [];
  for (const t of h.time) {
    const k = dayKey(t);
    if (days[days.length - 1] !== k) days.push(k);
  }
  return days;
}

/** Slice the hourly block to the days from `startKey` to `endKey`, inclusive. */
export function windowByDays(h: HourlyPoint, startKey: string, endKey: string): HourlyPoint {
  const start = h.time.findIndex((t) => dayKey(t) >= startKey);
  if (start < 0) return sliceHourly(h, 0, 0);
  let end = start;
  while (end < h.time.length && dayKey(h.time[end]) <= endKey) end++;
  return sliceHourly(h, start, end);
}

/** Index in `time` closest to (and not after) `nowIso`; -1 if out of range. */
export function findNowIndex(time: string[], nowIso: string): number {
  const target = nowIso.slice(0, 13); // YYYY-MM-DDTHH
  for (let i = time.length - 1; i >= 0; i--) {
    if (time[i].slice(0, 13) <= target) return i;
  }
  return -1;
}

export function dailySummaries(resp: ForecastResponse): DailySummary[] {
  const d = resp.daily;
  return d.time.map((date, i) => ({
    date,
    code: d.weather_code[i],
    tempMax: d.temperature_2m_max[i],
    tempMin: d.temperature_2m_min[i],
    precipSum: d.precipitation_sum[i],
    precipProbMax: d.precipitation_probability_max[i],
    precipHours: d.precipitation_hours[i],
    uvMax: d.uv_index_max[i],
    sunrise: d.sunrise[i],
    sunset: d.sunset[i],
  }));
}

/** Is the given local ISO time during daylight for its day's sunrise/sunset? */
export function isDaytime(iso: string, sunrise?: string, sunset?: string): boolean {
  if (!sunrise || !sunset) {
    const hour = Number(iso.slice(11, 13));
    return hour >= 6 && hour < 20;
  }
  return iso >= sunrise && iso <= sunset;
}
