// The query string holds "what is visible" (the location itself lives in the
// hash path). This hook maps the search params to typed state and back, omitting
// defaults so shared URLs stay short.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MAX_FORECAST_DAYS, MAX_PAST_DAYS } from "../api/openMeteo";
import type { Units } from "../utils/units";

export type SeriesKey = "temp" | "feels" | "dew" | "wetbulb" | "enthalpy";
export type PanelKey = "precip" | "atmo" | "air";

/** Default visible window width, in days. */
export const DEFAULT_WINDOW_DAYS = 10;

// The order here is the chip order. The derived series (wet bulb, enthalpy) are
// selectable but default OFF — see DEFAULTS.series — so the temp panel stays
// uncluttered until the user opts in.
export const ALL_SERIES: SeriesKey[] = ["temp", "feels", "dew", "wetbulb", "enthalpy"];
export const ALL_PANELS: PanelKey[] = ["precip", "atmo", "air"];

const DEFAULT_SERIES: SeriesKey[] = ["temp", "feels", "dew"];

export interface DashboardState {
  /** Visible window width, in days. */
  days: number;
  /** Window's left edge as an offset in days from today; negative = history. */
  offset: number;
  series: SeriesKey[];
  panels: PanelKey[];
  ci: boolean;
  extraModels: string[];
  units: Units;
}

const DEFAULTS: DashboardState = {
  days: DEFAULT_WINDOW_DAYS,
  offset: 0,
  series: DEFAULT_SERIES,
  panels: ALL_PANELS,
  ci: false,
  extraModels: [],
  units: "metric",
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

  const offsetParam = params.get("offset");
  const offsetRaw = offsetParam == null || offsetParam === "" ? 0 : Number(offsetParam);
  const offset = Number.isFinite(offsetRaw)
    ? clampNum(Math.round(offsetRaw), -MAX_PAST_DAYS, MAX_FORECAST_DAYS - 1)
    : DEFAULTS.offset;

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
    days,
    offset,
    series,
    panels,
    ci: params.get("ci") === "1",
    extraModels,
    units,
  };
}

function serializeState(state: DashboardState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.days !== DEFAULTS.days) params.set("days", String(state.days));
  if (state.offset !== DEFAULTS.offset) params.set("offset", String(state.offset));
  if (!sameSet(state.series, DEFAULTS.series)) params.set("layers", state.series.join(","));
  if (!sameSet(state.panels, DEFAULTS.panels)) params.set("panels", state.panels.join(","));
  if (state.ci) params.set("ci", "1");
  if (state.extraModels.length) params.set("models", state.extraModels.join(","));
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
    setOffset: (offset: number) => update({ offset }),
    setCi: (ci: boolean) => update({ ci }),
    setUnits: (units: Units) => update({ units }),
    setExtraModels: (extraModels: string[]) => update({ extraModels }),
  };
}
