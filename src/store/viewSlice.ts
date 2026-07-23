// The dashboard "view" state as a Redux slice. It's initialised from the current
// URL so the store and the address bar agree on the very first render (see
// urlSync.ts for the bidirectional glue). The view is intentionally global rather
// than per-location: when multiple locations become comparable, they share one
// timeline (days / offset / units / series / panels).

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  DEFAULTS,
  parseState,
  type DashboardState,
  type PanelKey,
  type SeriesKey,
} from "./urlState";
import type { Units } from "../utils/units";

/** Read the query string out of the initial hash URL (e.g. "#/toronto@..?days=1"). */
function initialView(): DashboardState {
  if (typeof window === "undefined") return DEFAULTS;
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  const search = qIndex >= 0 ? hash.slice(qIndex + 1) : "";
  return parseState(new URLSearchParams(search));
}

const toggle = <T extends string>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

const viewSlice = createSlice({
  name: "view",
  initialState: initialView,
  reducers: {
    /** Replace/merge the whole view — used by the URL→store sync and update(). */
    setView(state, action: PayloadAction<Partial<DashboardState>>) {
      Object.assign(state, action.payload);
    },
    setDays(state, action: PayloadAction<number>) {
      state.days = action.payload;
    },
    setOffset(state, action: PayloadAction<number>) {
      state.offset = action.payload;
    },
    setCi(state, action: PayloadAction<boolean>) {
      state.ci = action.payload;
    },
    setUnits(state, action: PayloadAction<Units>) {
      state.units = action.payload;
    },
    setExtraModels(state, action: PayloadAction<string[]>) {
      state.extraModels = action.payload;
    },
    toggleSeries(state, action: PayloadAction<SeriesKey>) {
      state.series = toggle(state.series, action.payload);
    },
    togglePanel(state, action: PayloadAction<PanelKey>) {
      state.panels = toggle(state.panels, action.payload);
    },
  },
});

export const {
  setView,
  setDays,
  setOffset,
  setCi,
  setUnits,
  setExtraModels,
  toggleSeries,
  togglePanel,
} = viewSlice.actions;

export const viewReducer = viewSlice.reducer;
