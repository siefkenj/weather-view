// Observed rain-gauge precipitation from Environment Canada (ECCC MSC GeoMet).
// The endpoints are CORS-enabled and key-free, so they run straight from the browser
// like Open-Meteo — no proxy. We take the nearest ACTIVE hourly climate station to the
// point and use its measured hourly PRECIP_AMOUNT for the PAST, in place of ERA5's
// modelled precip (see utils/observed). Canada-only: elsewhere no station is near and
// we keep ERA5.
//
// Timestamps: ECCC hourly LOCAL_DATE is Local STANDARD Time (no DST), so we align on
// UTC_DATE, converting each observation to the location's DST-aware local hour to match
// the Open-Meteo grid.

import { fetchJson } from "./http";

const STATIONS_URL = "https://api.weather.gc.ca/collections/climate-stations/items";
const HOURLY_URL = "https://api.weather.gc.ca/collections/climate-hourly/items";

export interface EcccStation {
  stnId: number;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

export interface StationPrecip {
  /** The gauge used, or null when no active station is near (e.g. outside Canada). */
  station: EcccStation | null;
  /** Measured hourly precip (mm) keyed by local-ISO hour ("YYYY-MM-DDTHH:00"). */
  precipByIso: Record<string, number>;
}

interface GeoFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

function buildUrl(base: string, params: Record<string, string | number>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

const RAD = Math.PI / 180;
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Format a UTC instant as the wall-clock local hour ("YYYY-MM-DDTHH:mm") in `timeZone`,
 *  matching Open-Meteo's DST-aware local grid. */
export function utcToZonedHourIso(utcDate: string, timeZone: string): string {
  const d = new Date(utcDate.endsWith("Z") ? utcDate : `${utcDate}Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = g("hour") === "24" ? "00" : g("hour"); // some engines emit "24" for midnight
  return `${g("year")}-${g("month")}-${g("day")}T${hour}:${g("minute")}`;
}

/** Nearest active hourly station in a stations feature list, or null. `cutoff`
 *  ("YYYY-MM-DD") is the earliest acceptable HLY_LAST_DATE — older stations are closed. */
export function pickNearestStation(
  features: GeoFeature[],
  lat: number,
  lon: number,
  cutoff: string,
): EcccStation | null {
  let best: EcccStation | null = null;
  for (const f of features) {
    const p = f.properties ?? {};
    if (p.HAS_HOURLY_DATA !== "Y") continue;
    const last = typeof p.HLY_LAST_DATE === "string" ? p.HLY_LAST_DATE.slice(0, 10) : "";
    if (last < cutoff) continue; // closed / stale
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const dist = haversineKm(lat, lon, coords[1], coords[0]);
    if (!best || dist < best.distanceKm) {
      best = {
        stnId: Number(p.STN_ID),
        name: String(p.STATION_NAME ?? "station"),
        latitude: coords[1],
        longitude: coords[0],
        distanceKm: dist,
      };
    }
  }
  return best;
}

/** Local-ISO → mm precip map from climate-hourly features (skips null/invalid). */
export function buildPrecipMap(features: GeoFeature[], timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of features) {
    const p = f.properties ?? {};
    const utc = p.UTC_DATE;
    const amt = p.PRECIP_AMOUNT;
    if (typeof utc !== "string" || typeof amt !== "number" || !Number.isFinite(amt)) continue;
    out[utcToZonedHourIso(utc, timeZone)] = amt;
  }
  return out;
}

export interface StationPrecipParams {
  latitude: number;
  longitude: number;
  timezone?: string;
}

// Station-search box half-widths (deg): ~70 km E-W near 45° lat, ~72 km N-S.
const BBOX_LON = 0.9;
const BBOX_LAT = 0.65;
// A station counts as active if it reported hourly data within this many days.
const ACTIVE_DAYS = 60;

export async function fetchStationPrecip(
  params: StationPrecipParams,
  signal?: AbortSignal,
): Promise<StationPrecip> {
  const empty: StationPrecip = { station: null, precipByIso: {} };
  if (!params.timezone) return empty; // can't align to the grid without a zone
  const { latitude: lat, longitude: lon } = params;
  const bbox = `${lon - BBOX_LON},${lat - BBOX_LAT},${lon + BBOX_LON},${lat + BBOX_LAT}`;
  // A city-sized bbox can hold hundreds of stations (mostly daily/closed), so pull them
  // all — trimmed to the fields we filter on (geometry is returned regardless) — and pick
  // the nearest active hourly one client-side. Server-side HAS_HOURLY_DATA filtering and
  // sortby on the date fields are unsupported/erratic here, hence the client-side pass.
  const stations = await fetchJson<{ features?: GeoFeature[] }>(
    buildUrl(STATIONS_URL, {
      bbox,
      properties: "STN_ID,STATION_NAME,HAS_HOURLY_DATA,HLY_LAST_DATE",
      limit: 1000,
      f: "json",
    }),
    { label: "gauge stations", signal, cache: true },
  );
  const cutoff = new Date(Date.now() - ACTIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const station = pickNearestStation(stations.features ?? [], lat, lon, cutoff);
  if (!station) return empty;

  // The most recent ~600 hourly rows (~25 days) cover the past window without date math.
  const hourly = await fetchJson<{ features?: GeoFeature[] }>(
    buildUrl(HOURLY_URL, {
      STN_ID: station.stnId,
      sortby: "-LOCAL_DATE",
      properties: "UTC_DATE,PRECIP_AMOUNT",
      limit: 600,
      f: "json",
    }),
    { label: "gauge precip", signal, cache: true },
  );
  return { station, precipByIso: buildPrecipMap(hourly.features ?? [], params.timezone) };
}
