// Blend several weather models into one consensus forecast.
//
// When ≥2 models are requested, Open-Meteo suffixes every variable per model
// (`temperature_2m_ecmwf_ifs025`, …) on a single shared `time` axis, null-padding
// where a model's horizon is shorter. Its `current` block, though, ignores the
// multi-model request and returns a single ambiguous snapshot — so we rebuild the
// consensus "current" from the hourly consensus at the current hour instead.
//
// The output has the exact shape of a normal single-model ForecastResponse, so the
// entire downstream pipeline (series reshaping, refine, meteogram, current card)
// consumes it unchanged — it just happens to be a blend. A `consensus` field is
// attached so the UI can explain how "now" was decided.
//
// Reduction per variable:
//   • ordinary numbers  → median across the models reporting a value (robust to a
//     single outlier model, unlike the mean)
//   • wind direction    → circular mean of unit vectors (so 350° and 10° average to
//     0°, not 180°)
//   • weather_code      → a wet/dry majority VOTE, then the median code within the
//     winning camp (see consensusWeatherCode) — this is what makes the blend report
//     rain when most models show rain, the whole point of the feature
//   • sunrise / sunset  → taken from the first model (astronomical; identical across)

import type {
  ConsensusMeta,
  ForecastCurrent,
  ForecastDaily,
  ForecastHourly,
  ForecastResponse,
} from "../api/types";

/** A per-model column: numbers with `null` where the model has no value. */
type Column = (number | null)[];
/** One raw block (hourly/daily) from a multi-model response: a shared `time` array
 *  plus `<var>_<model>` columns. */
type RawBlock = { time: string[] } & Record<string, unknown>;

/** The permissive shape of a raw multi-model forecast response, before blending. */
export interface RawMultiForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  elevation: number;
  current_units: Record<string, string>;
  current: { time: string; interval: number } & Record<string, unknown>;
  hourly_units: Record<string, string>;
  hourly: RawBlock;
  daily_units: Record<string, string>;
  daily: RawBlock;
}

// ---- Statistics ------------------------------------------------------------

/** Median of the values (assumed already finite). NaN for an empty set. */
export function median(vals: number[]): number {
  if (vals.length === 0) return NaN;
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean of bearings via unit vectors, in [0,360). NaN for an empty set. */
export function circularMeanDeg(degs: number[]): number {
  let x = 0;
  let y = 0;
  for (const d of degs) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  if (degs.length === 0) return NaN;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** WMO codes 51+ are drizzle/rain/snow/showers/thunder; 45/48 (fog) are not precip. */
export function isPrecipCode(code: number): boolean {
  return Number.isFinite(code) && code >= 51;
}

/**
 * Consensus WMO weather code from several models' codes for one moment.
 *
 * First a wet-vs-dry vote: if at least half the models show precipitation, the
 * consensus is wet (a tie favours rain — a missed shower reads worse than a
 * spurious cloud, and catching rain the automatic pick misses is the point). Then
 * the representative is the median code *within the winning camp* — always a code
 * some model actually reported, and roughly its middle intensity. NaN if empty.
 */
export function consensusWeatherCode(codes: number[]): number {
  const finite = codes.filter((c) => Number.isFinite(c));
  if (finite.length === 0) return NaN;
  const wet = finite.filter(isPrecipCode);
  const camp = wet.length * 2 >= finite.length ? wet : finite.filter((c) => !isPrecipCode(c));
  const s = [...camp].sort((a, b) => a - b);
  // Lower-middle for even counts, so the result is an actual reported code.
  return s[(s.length - 1) >> 1];
}

// ---- Column plumbing -------------------------------------------------------

function column(block: RawBlock, varName: string, model: string): Column | undefined {
  const v = block[`${varName}_${model}`];
  return Array.isArray(v) ? (v as Column) : undefined;
}

/** The finite values reported by `models` for `varName` at row `i`. */
function gather(block: RawBlock, varName: string, models: string[], i: number): number[] {
  const out: number[] = [];
  for (const m of models) {
    const x = column(block, varName, m)?.[i];
    if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  }
  return out;
}

/** Reduce one variable across all models into a single column. */
function reduceSeries(
  block: RawBlock,
  varName: string,
  models: string[],
  len: number,
  reducer: (vals: number[]) => number,
): number[] {
  const out = new Array<number>(len);
  for (let i = 0; i < len; i++) out[i] = reducer(gather(block, varName, models, i));
  return out;
}

/** Take a string column (sunrise/sunset) from the first model that has a value. */
function firstStrings(block: RawBlock, varName: string, models: string[], len: number): string[] {
  const cols = models
    .map((m) => block[`${varName}_${m}`])
    .filter((c): c is string[] => Array.isArray(c));
  const out = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    let s = "";
    for (const c of cols) {
      const v = c[i];
      if (typeof v === "string" && v) {
        s = v;
        break;
      }
    }
    out[i] = s;
  }
  return out;
}

/** Last index whose hour ≤ `nowIso`; 0 if `now` precedes the window, -1 if empty. */
function nearestHourIndex(time: string[], nowIso: string): number {
  const target = nowIso.slice(0, 13); // YYYY-MM-DDTHH
  for (let i = time.length - 1; i >= 0; i--) if (time[i].slice(0, 13) <= target) return i;
  return time.length ? 0 : -1;
}

// ---- Blend -----------------------------------------------------------------

export function buildConsensus(raw: RawMultiForecast, models: string[]): ForecastResponse {
  const time = raw.hourly.time;
  const H = time.length;
  const hourly: ForecastHourly = {
    time,
    temperature_2m: reduceSeries(raw.hourly, "temperature_2m", models, H, median),
    apparent_temperature: reduceSeries(raw.hourly, "apparent_temperature", models, H, median),
    dew_point_2m: reduceSeries(raw.hourly, "dew_point_2m", models, H, median),
    precipitation: reduceSeries(raw.hourly, "precipitation", models, H, median),
    precipitation_probability: reduceSeries(raw.hourly, "precipitation_probability", models, H, median),
    relative_humidity_2m: reduceSeries(raw.hourly, "relative_humidity_2m", models, H, median),
    surface_pressure: reduceSeries(raw.hourly, "surface_pressure", models, H, median),
    cloud_cover: reduceSeries(raw.hourly, "cloud_cover", models, H, median),
    shortwave_radiation: reduceSeries(raw.hourly, "shortwave_radiation", models, H, median),
    wind_speed_10m: reduceSeries(raw.hourly, "wind_speed_10m", models, H, median),
    wind_direction_10m: reduceSeries(raw.hourly, "wind_direction_10m", models, H, circularMeanDeg),
  };

  const dtime = raw.daily.time;
  const D = dtime.length;
  const daily: ForecastDaily = {
    time: dtime,
    weather_code: reduceSeries(raw.daily, "weather_code", models, D, consensusWeatherCode),
    sunrise: firstStrings(raw.daily, "sunrise", models, D),
    sunset: firstStrings(raw.daily, "sunset", models, D),
    uv_index_max: reduceSeries(raw.daily, "uv_index_max", models, D, median),
    precipitation_hours: reduceSeries(raw.daily, "precipitation_hours", models, D, median),
    precipitation_probability_max: reduceSeries(raw.daily, "precipitation_probability_max", models, D, median),
    precipitation_sum: reduceSeries(raw.daily, "precipitation_sum", models, D, median),
    temperature_2m_max: reduceSeries(raw.daily, "temperature_2m_max", models, D, median),
    temperature_2m_min: reduceSeries(raw.daily, "temperature_2m_min", models, D, median),
    wind_speed_10m_max: reduceSeries(raw.daily, "wind_speed_10m_max", models, D, median),
    wind_direction_10m_dominant: reduceSeries(raw.daily, "wind_direction_10m_dominant", models, D, circularMeanDeg),
  };

  // Rebuild "current" from the hourly consensus at the current hour (the raw
  // `current` block is single-model and ignores the request). This drives the
  // headline temperature and the fallback condition before the daily summary loads.
  const nowIso = raw.current?.time ?? time[time.length - 1] ?? "";
  const idx = nearestHourIndex(time, nowIso);
  const nowCodes = idx >= 0 ? gather(raw.hourly, "weather_code", models, idx) : [];

  const current: ForecastCurrent = {
    time: nowIso,
    interval: typeof raw.current?.interval === "number" ? raw.current.interval : 900,
    temperature_2m: idx >= 0 ? hourly.temperature_2m[idx] : NaN,
    apparent_temperature: idx >= 0 ? hourly.apparent_temperature[idx] : NaN,
    weather_code: consensusWeatherCode(nowCodes),
  };

  // Agreement is reported for TODAY, matching the headline (which now summarizes the
  // whole day, not "now"): how many models put today's dominant condition in the wet
  // camp. Keyed to today's row in the daily block (which may start before today when
  // past days are loaded).
  const todayCodes = gather(raw.daily, "weather_code", models, Math.max(0, dtime.indexOf(nowIso.slice(0, 10))));
  const wetVotes = todayCodes.filter(isPrecipCode).length;
  const wet = todayCodes.length > 0 && wetVotes * 2 >= todayCodes.length;
  const consensus: ConsensusMeta = {
    models,
    wet,
    agree: wet ? wetVotes : todayCodes.length - wetVotes,
    total: todayCodes.length,
  };

  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    timezone_abbreviation: raw.timezone_abbreviation,
    utc_offset_seconds: raw.utc_offset_seconds,
    elevation: raw.elevation,
    current_units: raw.current_units,
    current,
    hourly_units: raw.hourly_units,
    hourly,
    daily_units: raw.daily_units,
    daily,
    consensus,
  };
}
