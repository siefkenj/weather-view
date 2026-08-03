// Splice observed (ERA5 archive) history over the forecast's past.
//
// The forecast API's past hours are each model's own hindcast, not measurements. To
// show collected data for the past, we overwrite forecast values with the archive's
// observed values for every timestamp before "now" — leaving the present/future on the
// forecast (best_match or the consensus blend). Two seams:
//   • hourly: the current instant (elapsed hours today become observed)
//   • daily : whole prior days only (today's tile stays forecast — its afternoon is
//     still in the future, and the archive daily lacks UV / precip-chance)
//
// Overwrite is by timestamp with a per-field finite fallback: ERA5 usually returns
// null for the most recent hour(s) even when the range is allowed, so we keep the
// forecast value there rather than tear a hole in the line right before now.

import type { ArchiveHourly, ArchiveResponse } from "../api/types";
import type { DailySummary, HourlyPoint } from "./series";

const num = (x: number | null | undefined): number =>
  typeof x === "number" && Number.isFinite(x) ? x : NaN;

/** Replace the past (`time < nowIso`) of a forecast hourly block with observed values,
 *  matched by timestamp. Chance-of-precip is blanked in the past (not observable).
 *
 *  `gaugePrecip` (local-ISO hour → mm, from a real rain gauge) takes priority over the
 *  ERA5 model precip for the past: gauge → ERA5 → forecast. It's sparse (nearest station,
 *  Canada only, lags ~a day), so any hour it lacks falls through to ERA5. */
export function mergeObservedHourly(
  forecast: HourlyPoint,
  archive: ArchiveHourly,
  nowIso: string,
  gaugePrecip?: Record<string, number>,
): HourlyPoint {
  // Copy so the memoized forecast arrays are never mutated.
  const out: HourlyPoint = {
    time: forecast.time,
    temperature: forecast.temperature.slice(),
    apparent: forecast.apparent.slice(),
    dewPoint: forecast.dewPoint.slice(),
    precipitation: forecast.precipitation.slice(),
    precipProbability: forecast.precipProbability.slice(),
    humidity: forecast.humidity.slice(),
    cloudCover: forecast.cloudCover.slice(),
    pressure: forecast.pressure.slice(),
    radiation: forecast.radiation.slice(),
    windSpeed: forecast.windSpeed.slice(),
    windDirection: forecast.windDirection.slice(),
  };

  const idxOf = new Map<string, number>();
  for (let i = 0; i < archive.time.length; i++) idxOf.set(archive.time[i], i);

  // Overwrite dst[j] with src[i] only when the observed value is finite.
  const put = (dst: number[], src: (number | null)[], i: number, j: number) => {
    const v = src[i];
    if (typeof v === "number" && Number.isFinite(v)) dst[j] = v;
  };

  for (let j = 0; j < forecast.time.length; j++) {
    const t = forecast.time[j];
    if (t >= nowIso) continue; // only the past
    out.precipProbability[j] = NaN; // a probability can't be observed
    const i = idxOf.get(t);
    if (i != null) {
      put(out.temperature, archive.temperature_2m, i, j);
      put(out.apparent, archive.apparent_temperature, i, j);
      put(out.dewPoint, archive.dew_point_2m, i, j);
      put(out.precipitation, archive.precipitation, i, j);
      put(out.humidity, archive.relative_humidity_2m, i, j);
      put(out.cloudCover, archive.cloud_cover, i, j);
      put(out.pressure, archive.surface_pressure, i, j);
      put(out.radiation, archive.shortwave_radiation, i, j);
      put(out.windSpeed, archive.wind_speed_10m, i, j);
      put(out.windDirection, archive.wind_direction_10m, i, j);
    }
    // Real gauge precip wins over the ERA5 model value when present.
    const g = gaugePrecip?.[t];
    if (typeof g === "number" && Number.isFinite(g)) out.precipitation[j] = g;
  }
  return out;
}

/** Reshape the archive daily block into DailySummary, with the fields the archive
 *  doesn't carry (UV max, precip-chance max) left as NaN. */
export function archiveDailySummaries(archive: ArchiveResponse): DailySummary[] {
  const d = archive.daily;
  return d.time.map((date, i) => ({
    date,
    code: num(d.weather_code[i]),
    tempMax: num(d.temperature_2m_max[i]),
    tempMin: num(d.temperature_2m_min[i]),
    precipSum: num(d.precipitation_sum[i]),
    precipProbMax: NaN, // not observable
    precipHours: num(d.precipitation_hours[i]),
    uvMax: NaN, // ERA5 archive doesn't carry it
    sunrise: d.sunrise[i] ?? "",
    sunset: d.sunset[i] ?? "",
    windMax: num(d.wind_speed_10m_max[i]),
    windDir: num(d.wind_direction_10m_dominant[i]),
  }));
}

/** Replace whole PRIOR days (`date < todayKey`) with their observed summaries; today
 *  and future stay on the forecast. */
export function mergeObservedDaily(
  forecast: DailySummary[],
  archive: DailySummary[],
  todayKey: string,
): DailySummary[] {
  const byDate = new Map(archive.map((s) => [s.date, s]));
  return forecast.map((s) => (s.date < todayKey ? byDate.get(s.date) ?? s : s));
}
