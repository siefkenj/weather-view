// The query string holds "what is visible" (the location itself lives in the
// hash path). This hook maps the search params to typed state and back, omitting
// defaults so shared URLs stay short.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import type { Units } from "../utils/units";

export type ViewMode = "forecast" | "history";
export type SeriesKey = "temp" | "feels" | "dew" | "wetbulb" | "enthalpy";
export type PanelKey = "precip" | "atmo" | "air";

// The order here is the chip order. The derived series (wet bulb, enthalpy) are
// selectable but default OFF — see DEFAULTS.series — so the temp panel stays
// uncluttered until the user opts in.
export const ALL_SERIES: SeriesKey[] = ["temp", "feels", "dew", "wetbulb", "enthalpy"];
export const ALL_PANELS: PanelKey[] = ["precip", "atmo", "air"];

const DEFAULT_SERIES: SeriesKey[] = ["temp", "feels", "dew"];

export interface DashboardState {
  view: ViewMode;
  days: number;
  series: SeriesKey[];
  panels: PanelKey[];
  ci: boolean;
  extraModels: string[];
  date: string | null;
  units: Units;
}

const DEFAULTS: DashboardState = {
  view: "forecast",
  days: MAX_FORECAST_DAYS,
  series: DEFAULT_SERIES,
  panels: ALL_PANELS,
  ci: false,
  extraModels: [],
  date: null,
  units: "metric",
};

function parseCsv<T extends string>(value: string | null, allowed: readonly T[]): T[] | null {
  if (value == null) return null;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return parts;
}

export function parseState(params: URLSearchParams): DashboardState {
  const view = params.get("view") === "history" ? "history" : "forecast";

  const daysParam = params.get("days");
  const daysRaw = daysParam == null || daysParam === "" ? NaN : Number(daysParam);
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.round(daysRaw), 1), MAX_FORECAST_DAYS)
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

  return {
    view,
    days,
    series,
    panels,
    ci: params.get("ci") === "1",
    extraModels,
    date: params.get("date"),
    units,
  };
}

function serializeState(state: DashboardState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== DEFAULTS.view) params.set("view", state.view);
  if (state.days !== DEFAULTS.days) params.set("days", String(state.days));
  if (!sameSet(state.series, DEFAULTS.series)) params.set("layers", state.series.join(","));
  if (!sameSet(state.panels, DEFAULTS.panels)) params.set("panels", state.panels.join(","));
  if (state.ci) params.set("ci", "1");
  if (state.extraModels.length) params.set("models", state.extraModels.join(","));
  if (state.view === "history" && state.date) params.set("date", state.date);
  if (state.units !== DEFAULTS.units) params.set("units", state.units);
  return params;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

export function useDashboardState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseState(searchParams), [searchParams]);

  const update = useCallback(
    (patch: Partial<DashboardState>) => {
      setSearchParams(serializeState({ ...parseState(searchParams), ...patch }), {
        replace: true,
      });
    },
    [searchParams, setSearchParams],
  );

  const toggleIn = useCallback(
    <T extends string>(list: T[], value: T): T[] =>
      list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    [],
  );

  return {
    state,
    update,
    toggleSeries: (key: SeriesKey) => update({ series: toggleIn(state.series, key) }),
    togglePanel: (key: PanelKey) => update({ panels: toggleIn(state.panels, key) }),
    setDays: (days: number) => update({ days }),
    setView: (view: ViewMode) => update({ view }),
    setCi: (ci: boolean) => update({ ci }),
    setUnits: (units: Units) => update({ units }),
    setDate: (date: string | null) => update({ date }),
    setExtraModels: (extraModels: string[]) => update({ extraModels }),
  };
}
