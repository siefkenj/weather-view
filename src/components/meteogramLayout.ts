// Vertical layout (percentages) for the horizontal meteogram's stacked panels.
// Shared by the option builder and the React component so the chart grids and
// the HTML day-tile overlay agree on where the temperature panel ends.

import type { PanelKey } from "../hooks/useUrlState";

export type PanelName = "temp" | "precip" | "atmo" | "air";

export interface HorizontalLayout {
  panelKeys: PanelName[];
  grids: { top: number; height: number }[];
}

const WEIGHTS: Record<PanelName, number> = { temp: 2.3, precip: 1, atmo: 1.15, air: 1 };

// Extra range added to the temperature y-axis so the top of the panel is empty
// — that's where the on-graph date/icon overlay sits, clear of the lines.
export const TEMP_HEADROOM = { top: 0.45, bottom: 0.05 };

/** Fraction of the temp panel's plotting height left empty at the top. */
export function tempTopEmptyFraction(): number {
  return TEMP_HEADROOM.top / (1 + TEMP_HEADROOM.top + TEMP_HEADROOM.bottom);
}

export function computeHorizontalLayout(panels: PanelKey[]): HorizontalLayout {
  const panelKeys: PanelName[] = [
    "temp",
    ...(panels.includes("precip") ? (["precip"] as const) : []),
    ...(panels.includes("atmo") ? (["atmo"] as const) : []),
    ...(panels.includes("air") ? (["air"] as const) : []),
  ];

  const topPad = 3;
  const bottomPad = 7;
  const gap = 1.5;

  const usable = 100 - topPad - bottomPad - gap * (panelKeys.length - 1);
  const weightSum = panelKeys.reduce((s, k) => s + WEIGHTS[k], 0);

  const grids: { top: number; height: number }[] = [];
  let cursor = topPad;
  panelKeys.forEach((k, i) => {
    if (i > 0) cursor += gap;
    const height = (usable * WEIGHTS[k]) / weightSum;
    grids.push({ top: cursor, height });
    cursor += height;
  });

  return { panelKeys, grids };
}
