// Per-day background shading shared by both meteogram orientations. Weekday
// stripes alternate faintly; weekend days (Sat/Sun) get a distinct tint so they
// stand out at a glance. Each markArea item carries its own color.

import type { ChartPalette } from "../theme/palette";

/** Indices in `time` where the calendar day changes. */
export function dayBoundaries(time: string[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (i === 0 || time[i].slice(8, 10) !== time[i - 1].slice(8, 10)) idx.push(i);
  }
  return idx;
}

/**
 * markArea (with per-item colors) shading each day. `axis` is "xAxis" for the
 * horizontal chart and "yAxis" for the transposed one.
 */
export function dayShadeMarkArea(time: string[], palette: ChartPalette, axis: "xAxis" | "yAxis") {
  const bounds = dayBoundaries(time);
  const data: unknown[] = [];
  for (let b = 0; b < bounds.length; b++) {
    const start = time[bounds[b]];
    const endIdx = b + 1 < bounds.length ? bounds[b + 1] : time.length;
    const end = time[Math.min(endIdx, time.length - 1)];
    // The date digits are already location-local, so getDay() is the local weekday.
    const dow = new Date(start).getDay();
    const weekend = dow === 0 || dow === 6;
    const color = weekend ? palette.weekendShade : b % 2 === 0 ? palette.dayShade : null;
    if (!color) continue;
    const from: Record<string, unknown> = { itemStyle: { color } };
    const to: Record<string, unknown> = {};
    from[axis] = start;
    to[axis] = end;
    data.push([from, to]);
  }
  return { silent: true, data };
}
