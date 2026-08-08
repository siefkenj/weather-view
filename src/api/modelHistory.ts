// Historical precipitation downloads for the in-browser "find best combination"
// optimizer (see utils/modelEval + hooks/useBestCombination). Everything is fetched in
// UTC (Open-Meteo `timezone=GMT`, ECCC keyed on UTC_DATE) so model and truth align by
// hour string with no timezone math. All endpoints are CORS-enabled and key-free.

import { fetchJson } from "./http";
import { fetchStationPrecipWindowUtc, type EcccStation } from "./eccc";
import { MODELS } from "../utils/models";
import type { Place } from "./types";

const HISTORICAL_FORECAST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

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
  if (h) {
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
    // (e.g. KNMI ≈ ECMWF over N. America), so they'd duplicate that model in the search
    // and the results. Keep models in catalog order (globals first), dropping any whose
    // precip is ~identical to one already kept.
    for (const id of ids) {
      if (!byModel[id]) continue;
      if (models.some((k) => seriesCorr(byModel[k], byModel[id]) > 0.99)) continue;
      models.push(id);
    }
  }
  return { models, byModel };
}

/** Pearson correlation of two UTC-keyed precip series over their shared hours. */
function seriesCorr(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Object.keys(a).filter((k) => k in b);
  if (keys.length < 100) return 0;
  const n = keys.length;
  let mx = 0;
  let my = 0;
  for (const k of keys) {
    mx += a[k];
    my += b[k];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const k of keys) {
    const u = a[k] - mx;
    const v = b[k] - my;
    num += u * v;
    dx += u * u;
    dy += v * v;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
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
  const gauge = await fetchStationPrecipWindowUtc(place, startDate, endDate, signal);
  if (gauge.station && Object.keys(gauge.precipByUtc).length > 0) {
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
  return {
    source: "reanalysis",
    label: "ERA5 reanalysis",
    point,
    precip: await fetchReanalysisPrecip(point, startDate, endDate, signal),
    station: null,
  };
}
