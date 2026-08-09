// Historical precipitation downloads for the in-browser "find best combination"
// optimizer (see utils/modelEval + hooks/useBestCombination). Everything is fetched in
// UTC (Open-Meteo `timezone=GMT`, ECCC keyed on UTC_DATE) so model and truth align by
// hour string with no timezone math. All endpoints are CORS-enabled and key-free.

import { fetchJson } from "./http";
import { fetchStationPrecipWindowUtc, type EcccStation } from "./eccc";
import { MODELS } from "../utils/models";
import { WET_MM } from "../utils/modelEval";
import { addDays } from "../utils/format";
import type { Place } from "./types";

const HISTORICAL_FORECAST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

/** ERA5 lands ~5 days behind, and the archive silently gap-fills that tail with ECMWF
 *  IFS *forecasts*. Scoring against that tail would be scoring ECMWF against itself and
 *  would hand it the ranking, so reanalysis truth stops this far short of the window. */
export const REANALYSIS_LAG_DAYS = 6;

/** Fraction of the window a rain gauge must actually report before it is preferred over
 *  ERA5. Stations open and close mid-window and some are seasonal, so "returned at least
 *  one row" is no evidence of a usable record — a station covering two weeks of a 96-day
 *  window would otherwise win and throw away 90 days of usable reanalysis truth. */
export const MIN_GAUGE_COVERAGE = 0.8;

/** Whole hours spanned by an inclusive [startDate, endDate] day window; 0 if unparseable. */
function windowHours(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T00:00Z`);
  const b = Date.parse(`${endDate}T00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return (b - a) / 3_600_000 + 24;
}

function buildUrl(base: string, params: Record<string, string | number>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

interface HistoryResponse {
  hourly?: { time: string[] } & Record<string, unknown>;
}

export interface ModelPrecipHistory {
  /** Models that actually returned data at the point (regional-only models drop out). */
  models: string[];
  /** model id → { UTC hour "YYYY-MM-DDTHH:mm" → mm }. */
  byModel: Record<string, Record<string, number>>;
}

/** Each catalog model's hourly precip at `point` over [startDate, endDate], UTC-keyed.
 *  Models with no data at the point (e.g. KNMI / MET-Norway outside Europe) are dropped. */
export async function fetchModelPrecipHistory(
  point: { latitude: number; longitude: number },
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<ModelPrecipHistory> {
  const ids = MODELS.map((m) => m.id);
  const resp = await fetchJson<HistoryResponse>(
    buildUrl(HISTORICAL_FORECAST_URL, {
      latitude: point.latitude,
      longitude: point.longitude,
      hourly: "precipitation",
      models: ids.join(","),
      start_date: startDate,
      end_date: endDate,
      timezone: "GMT",
      precipitation_unit: "mm",
    }),
    { label: "model history", signal, cache: true },
  );
  const h = resp.hourly;
  const byModel: Record<string, Record<string, number>> = {};
  const models: string[] = [];
  // `time` is typed as present but comes off the wire — an `hourly` block without it
  // should yield an empty result, not a TypeError.
  if (h && Array.isArray(h.time)) {
    for (const id of ids) {
      const col = h[`precipitation_${id}`];
      if (!Array.isArray(col)) continue;
      const series: Record<string, number> = {};
      for (let i = 0; i < h.time.length; i++) {
        const v = col[i];
        if (typeof v === "number" && Number.isFinite(v)) series[h.time[i]] = v;
      }
      if (Object.keys(series).length) byModel[id] = series;
    }
    // Regional "seamless" models fall back to a global backbone outside their region
    // (e.g. KNMI ≈ ECMWF over N. America), so they'd duplicate that model in the search.
    // A duplicate is worse than a wasted slot: it double-weights that model inside every
    // median. Keep models in catalog order (globals first), dropping the echoes.
    for (const id of ids) {
      if (!byModel[id]) continue;
      if (models.some((k) => isDuplicateSeries(byModel[k], byModel[id]))) continue;
      models.push(id);
    }
  }
  return { models, byModel };
}

/**
 * True when two precip series are effectively the same model output — either the amounts
 * match almost everywhere, or (for a re-interpolated fallback) they agree on almost every
 * wet hour. Both bars are far above what two genuinely distinct global models reach over
 * a season, so this drops echoes without ever discarding a real candidate.
 */
function isDuplicateSeries(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a).filter((k) => k in b);
  if (keys.length < 24 * 14) return false; // too little overlap to judge
  let same = 0;
  let wetBoth = 0;
  let wetEither = 0;
  for (const k of keys) {
    if (Math.abs(a[k] - b[k]) <= 0.05) same++;
    const wa = a[k] >= WET_MM;
    const wb = b[k] >= WET_MM;
    if (wa && wb) wetBoth++;
    if (wa || wb) wetEither++;
  }
  return same / keys.length >= 0.99 || (wetEither > 0 && wetBoth / wetEither >= 0.98);
}

export interface TruthPrecip {
  source: "gauge" | "reanalysis";
  /** Human label for the panel, e.g. "Toronto City gauge · 4 km" or "ERA5 reanalysis". */
  label: string;
  /** The point the model history should be sampled at (the gauge, or the location). */
  point: { latitude: number; longitude: number };
  /** UTC hour "YYYY-MM-DDTHH:mm" → measured/reanalysis mm. */
  precip: Record<string, number>;
  station: EcccStation | null;
}

/** ERA5 reanalysis precip at `point` over the window, UTC-keyed (global fallback truth). */
async function fetchReanalysisPrecip(
  point: { latitude: number; longitude: number },
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const resp = await fetchJson<{ hourly?: { time: string[]; precipitation?: (number | null)[] } }>(
    buildUrl(ARCHIVE_URL, {
      latitude: point.latitude,
      longitude: point.longitude,
      hourly: "precipitation",
      start_date: startDate,
      end_date: endDate,
      timezone: "GMT",
      precipitation_unit: "mm",
    }),
    { label: "reanalysis history", signal, cache: true },
  );
  const h = resp.hourly;
  const out: Record<string, number> = {};
  if (h?.precipitation) {
    for (let i = 0; i < h.time.length; i++) {
      const v = h.precipitation[i];
      if (typeof v === "number" && Number.isFinite(v)) out[h.time[i]] = v;
    }
  }
  return out;
}

/** Ground-truth precip for the optimizer: the nearest ECCC rain gauge (Canada), else
 *  ERA5 reanalysis at the location. Returns the point the models should be sampled at. */
export async function fetchTruthPrecip(
  place: Place,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<TruthPrecip> {
  // The gauge lookup hits Environment Canada for EVERY location on earth — the request
  // isn't gated to Canada, it just returns no station elsewhere. So its failures are not
  // Canadian problems: out-of-range bboxes near the poles/antimeridian answer HTTP 500,
  // and any ECCC outage or rate-limit does the same. None of that should sink a run that
  // ERA5 can serve perfectly well, so a failed gauge lookup falls through to reanalysis.
  const gauge = await fetchStationPrecipWindowUtc(place, startDate, endDate, signal).catch(
    (err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return { station: null, precipByUtc: {} };
    },
  );
  const hours = Object.keys(gauge.precipByUtc).length;
  if (gauge.station && hours >= MIN_GAUGE_COVERAGE * windowHours(startDate, endDate)) {
    const s = gauge.station;
    return {
      source: "gauge",
      label: `${s.name} gauge · ${Math.round(s.distanceKm)} km`,
      point: { latitude: s.latitude, longitude: s.longitude },
      precip: gauge.precipByUtc,
      station: s,
    };
  }
  const point = { latitude: place.latitude, longitude: place.longitude };
  // Stop short of the IFS-filled tail (see REANALYSIS_LAG_DAYS); never past the start.
  const era5End = addDays(endDate, -REANALYSIS_LAG_DAYS);
  return {
    source: "reanalysis",
    label: "ERA5 reanalysis",
    point,
    // `>=`, not `>`: the endpoint's window is inclusive, so era5End === startDate is a
    // full valid day of truth rather than an empty request.
    precip:
      era5End >= startDate
        ? await fetchReanalysisPrecip(point, startDate, era5End, signal)
        : {},
    station: null,
  };
}
