// Compatibility hook: `useDashboardState()` keeps its original shape ({ state,
// setDays, toggleSeries, ... }) but is now backed by the Redux view slice instead
// of reading the URL directly. The URL is kept in sync separately by useUrlSync
// (store/urlSync.ts). Types/constants are re-exported from store/urlState so the
// existing `../hooks/useUrlState` import paths keep working.

import { useAppDispatch, useAppSelector } from "../store";
import {
  setCi,
  setDays,
  setExtraModels,
  setUnits,
  setView,
  setViewStart,
  setZoom,
  togglePanel,
  toggleSeries,
} from "../store/viewSlice";
import type { DashboardState, PanelKey, SeriesKey } from "../store/urlState";
import type { Units } from "../utils/units";

export type { DashboardState, PanelKey, SeriesKey } from "../store/urlState";
export {
  ALL_SERIES,
  ALL_PANELS,
  DEFAULT_WINDOW_DAYS,
  DEFAULTS,
  parseState,
  serializeState,
} from "../store/urlState";

export function useDashboardState() {
  const state = useAppSelector((s) => s.view);
  const dispatch = useAppDispatch();

  return {
    state,
    update: (patch: Partial<DashboardState>) => dispatch(setView(patch)),
    toggleSeries: (key: SeriesKey) => dispatch(toggleSeries(key)),
    togglePanel: (key: PanelKey) => dispatch(togglePanel(key)),
    setDays: (days: number) => dispatch(setDays(days)),
    setViewStart: (viewStart: string | null) => dispatch(setViewStart(viewStart)),
    setZoom: (zoom: number | null) => dispatch(setZoom(zoom)),
    setCi: (ci: boolean) => dispatch(setCi(ci)),
    setUnits: (units: Units) => dispatch(setUnits(units)),
    setExtraModels: (extraModels: string[]) => dispatch(setExtraModels(extraModels)),
  };
}
