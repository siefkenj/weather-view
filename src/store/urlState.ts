// The dashboard "view" state — what is visible in the chart — and its canonical
// URL (query-string) encoding. The query string holds this state; the location
// itself lives in the hash path. Parsing/serialising lives here so the Redux
// slice, the URL<->store sync glue, and the tests all share one implementation.

import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import type { Units } from "../utils/units";
import type { AirMode } from "../utils/airColors";

/** The forecast graph's air-quality panel: off, or showing one of the two indices. */
export type AirPanelMode = "off" | AirMode;

export type SeriesKey = "temp" | "feels" | "dew" | "wetbulb" | "enthalpy" | "wind";
export type PanelKey = "precip" | "atmo" | "air";

/** Default visible window width, in days. */
export const DEFAULT_WINDOW_DAYS = 10;

// The order here is the chip/legend order. The derived series (wet bulb, enthalpy)
// are selectable but default OFF — see DEFAULTS.series — so the temp panel stays
// uncluttered until the user opts in.
export const ALL_SERIES: SeriesKey[] = ["temp", "feels", "dew", "wetbulb", "enthalpy", "wind"];
export const ALL_PANELS: PanelKey[] = ["precip", "atmo", "air"];

const DEFAULT_SERIES: SeriesKey[] = ["temp", "feels"];

export interface DashboardState {
  /** Visible window width, in days. */
  days: number;
  /**
   * The window's left edge as a local ISO datetime ("YYYY-MM-DDTHH:mm"), or `null`
   * to auto-anchor to today. Continuous (any value while dragging); day-quantised
   * when the arrows are pressed. Clamped to the fetched data range at read time (the
   * range isn't known here — see the Dashboard). This is session-only pan state and
   * is deliberately NOT persisted to the URL, so it never appears in parse/serialize.
   */
  viewStart: string | null;
  /**
   * Radar map zoom level, or `null` to fit the default ~80 km region. Like
   * `viewStart`, this is session-only state kept in Redux but deliberately NOT
   * persisted to the URL, so it never appears in parse/serialize.
   */
  zoom: number | null;
  series: SeriesKey[];
  panels: PanelKey[];
  ci: boolean;
  extraModels: string[];
  units: Units;
  /** Air-quality index shown on the forecast graph (or off). Persisted in the URL. */
  airMode: AirPanelMode;
}

export const DEFAULTS: DashboardState = {
  days: DEFAULT_WINDOW_DAYS,
  viewStart: null,
  zoom: 2,
  series: DEFAULT_SERIES,
  panels: ALL_PANELS,
  ci: false,
  extraModels: [],
  units: "metric",
  airMode: "aqhi",
};


const clampNum = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function parseCsv<T extends string>(value: string | null, allowed: readonly T[]): T[] | null {
  if (value == null) return null;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return parts;
}

export function parseState(params: URLSearchParams): DashboardState {
  const daysParam = params.get("days");
  const daysRaw = daysParam == null || daysParam === "" ? NaN : Number(daysParam);
  const days = Number.isFinite(daysRaw)
    ? clampNum(Math.round(daysRaw), 1, MAX_FORECAST_DAYS)
    : DEFAULTS.days;

  const series = parseCsv(params.get("layers"), ALL_SERIES) ?? DEFAULTS.series;
  const panels = parseCsv(params.get("panels"), ALL_PANELS) ?? DEFAULTS.panels;

  const modelsRaw = params.get("models");
  const extraModels = modelsRaw
    ? modelsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULTS.extraModels;

  const units: Units = params.get("units") === "imperial" ? "imperial" : "metric";

  const airRaw = params.get("air");
  const airMode: AirPanelMode = airRaw === "off" || airRaw === "aqi" ? airRaw : "aqhi";

  return {
    days,
    viewStart: null, // session-only pan state; never read from the URL
    zoom: null, // session-only map zoom; never read from the URL
    series,
    panels,
    ci: params.get("ci") === "1",
    extraModels,
    units,
    airMode,
  };
}

export function serializeState(state: DashboardState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.days !== DEFAULTS.days) params.set("days", String(state.days));
  if (!sameSet(state.series, DEFAULTS.series)) params.set("layers", state.series.join(","));
  if (!sameSet(state.panels, DEFAULTS.panels)) params.set("panels", state.panels.join(","));
  if (state.ci) params.set("ci", "1");
  if (state.extraModels.length) params.set("models", state.extraModels.join(","));
  if (state.units !== DEFAULTS.units) params.set("units", state.units);
  if (state.airMode !== DEFAULTS.airMode) params.set("air", state.airMode);
  return params;
}

/** Canonical query string for a view state — used to compare two states cheaply. */
export function viewToQuery(state: DashboardState): string {
  return serializeState(state).toString();
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}
