// Vertical layout (percentages) for the horizontal meteogram's stacked panels.
// Shared by the option builder and the React component so the chart grids and
// the HTML day-tile overlay agree on where the temperature panel ends.

import type { PanelKey } from "../hooks/useUrlState";

export type PanelName = "temp" | "precip" | "atmo" | "air";

/** Left plot inset (px): room for the left-axis title + tick labels. */
export const AXIS_GUTTER = 56;
/** Right plot inset (px) on mobile, where all right-axis labels are hidden so the
 *  plot reclaims the space. Desktop uses AXIS_GUTTER on both sides. Kept in sync
 *  with the `.forecast-header__row` right inset in index.css. */
export const AXIS_GUTTER_RIGHT_MOBILE = 8;

/** Meteogram canvas height (px): the default, and the taller "integrated" height used
 *  when the day/date tiles are drawn in the temperature panel's headroom. Exported so
 *  the blank-chart placeholder can reserve the exact height the real chart will take —
 *  the chart then draws into the same box with no reflow. Keep in sync with
 *  `resolvedHeight` in Meteogram.tsx. */
export const CHART_HEIGHT = 520;
export const CHART_HEIGHT_INTEGRATED = 560;

export interface HorizontalLayout {
  panelKeys: PanelName[];
  grids: { top: number; height: number }[];
}

const WEIGHTS: Record<PanelName, number> = { temp: 2.3, precip: 1, atmo: 1.15, air: 1 };

/** Empty band (% of chart height) reserved at the very top for the date/icon tiles when
 *  the temperature panel — which normally hosts them in its headroom — is hidden. */
export const TILE_BAND = 11;
/** Base top padding (%) above the first panel. */
export const LAYOUT_TOP_PAD = 3;

// Extra range added to the temperature y-axis so the top of the panel is empty
// — that's where the on-graph date/icon overlay sits, clear of the lines.
export const TEMP_HEADROOM = { top: 0.45, bottom: 0.05 };

/** Fraction of the temp panel's plotting height left empty at the top. */
export function tempTopEmptyFraction(): number {
  return TEMP_HEADROOM.top / (1 + TEMP_HEADROOM.top + TEMP_HEADROOM.bottom);
}

export interface HorizontalLayoutOptions {
  /** Include the temperature panel (default true). Dropped when every temp line is off. */
  includeTemp?: boolean;
  /** Extra top band (%) to reserve for the date tiles when there's no temp panel to host
   *  them — see TILE_BAND. Ignored when the temp panel is present. */
  tileBand?: number;
}

export function computeHorizontalLayout(
  panels: PanelKey[],
  opts: HorizontalLayoutOptions = {},
): HorizontalLayout {
  const includeTemp = opts.includeTemp ?? true;
  const tileBand = includeTemp ? 0 : opts.tileBand ?? 0;
  const panelKeys: PanelName[] = [
    ...(includeTemp ? (["temp"] as const) : []),
    ...(panels.includes("precip") ? (["precip"] as const) : []),
    ...(panels.includes("atmo") ? (["atmo"] as const) : []),
    ...(panels.includes("air") ? (["air"] as const) : []),
  ];

  const topPad = LAYOUT_TOP_PAD + tileBand;
  const bottomPad = 7;
  const gap = 1.5;

  const usable = 100 - topPad - bottomPad - gap * Math.max(0, panelKeys.length - 1);
  const weightSum = panelKeys.reduce((s, k) => s + WEIGHTS[k], 0) || 1;

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
