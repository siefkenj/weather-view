// Which of the meteogram's two readouts is currently open. They are mutually
// exclusive by design: the per-day forecast popover (opened by hovering a day
// tile) and the hover details (ECharts' axis tooltip over the plot) must never be
// shown at the same time. Both pieces of UI read from and write to this ONE field,
// so it is structurally impossible for both to be open — only one `kind` fits.
//
// This lives outside the URL-synced `view` slice on purpose: it's transient,
// per-session interaction state, not something to serialize into the address bar.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Readout =
  | { kind: "none" }
  | { kind: "day"; date: string; left: number } // day popover: which day + its x-position
  | { kind: "hover" }; // the chart's axis tooltip is showing

const readoutSlice = createSlice({
  name: "readout",
  initialState: { kind: "none" } as Readout,
  reducers: {
    // Opening either readout REPLACES whatever was open — that's the exclusion.
    openDay: (_state, action: PayloadAction<{ date: string; left: number }>): Readout => ({
      kind: "day",
      date: action.payload.date,
      left: action.payload.left,
    }),
    openHover: (state): Readout | void => {
      if (state.kind !== "hover") return { kind: "hover" };
    },
    // Each closer clears only its OWN readout, so a stale mouse-out from one piece
    // of UI can't stomp the other one that just opened.
    closeDay: (state): Readout | void => {
      if (state.kind === "day") return { kind: "none" };
    },
    closeHover: (state): Readout | void => {
      if (state.kind === "hover") return { kind: "none" };
    },
  },
});

export const { openDay, openHover, closeDay, closeHover } = readoutSlice.actions;
export const readoutReducer = readoutSlice.reducer;
