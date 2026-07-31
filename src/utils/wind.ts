// Wind direction is a compass bearing for the direction the wind blows FROM
// (meteorological convention): 0° = wind out of the north, 90° = out of the east.
// Speed is always shown in km/h — matching the meteogram, which (like precip in mm)
// never switches units with the °C/°F toggle.

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/** 16-point compass abbreviation for a "from" bearing in degrees (0 = N, clockwise).
 *  Empty string when the bearing is unknown. */
export function windCompass(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "";
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_16[i];
}

// A long arrow, rotated by CSS to the exact bearing instead of snapping to one of a
// handful of pre-drawn glyphs — so it shows the true direction. The glyph points east
// (a 90° bearing) at rest, so the rotation below is measured from there.
export const WIND_ARROW_GLYPH = "⟶";
const ARROW_BASE_BEARING = 90; // ⟶ points east

/** Clockwise rotation (deg) that aims the arrow at the source bearing, so it points
 *  back the way a weathervane would — toward where the wind is blowing from, agreeing
 *  with the compass abbreviation. Offset by the glyph's own east orientation. Null
 *  when the bearing is unknown. */
export function windArrowRotation(deg: number | null | undefined): number | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return ((((deg - ARROW_BASE_BEARING) % 360) + 360) % 360);
}

/** Inline HTML for a wind arrow rotated to the exact `deg` source bearing, for the
 *  ECharts tooltip (an HTML string). Empty when the bearing is unknown. */
export function windArrowSpan(deg: number | null | undefined, opts: { color?: string } = {}): string {
  const rot = windArrowRotation(deg);
  if (rot == null) return "";
  const color = opts.color ? `;color:${opts.color}` : "";
  return `<span style="display:inline-block;transform:rotate(${rot}deg)${color}">${WIND_ARROW_GLYPH}</span>`;
}

/** Wind speed as "16 km/h" (rounded, always km/h); "–" when there's no speed. */
export function formatWindSpeed(kmh: number | null | undefined): string {
  return kmh != null && Number.isFinite(kmh) ? `${Math.round(kmh)} km/h` : "–";
}
