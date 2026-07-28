// One air-quality colour scheme shared by every chart — the map field, the
// meteogram air panel, the AQHI/AQI chips, and the day popups. Both indices map
// their value onto a SINGLE severity ramp (green = good / low risk → umber =
// hazardous / very high), so AQI and AQHI look the same at the same severity; only
// the value→position mapping differs. Interpolation fills any in-between colours.

export type AirMode = "aqhi" | "aqi";

type RGB = [number, number, number];

// The shared ramp, position 0 (good / low) → 1 (hazardous / very high).
const RAMP: { t: number; c: RGB }[] = [
  { t: 0.0, c: [38, 166, 91] }, // green
  { t: 0.28, c: [242, 201, 30] }, // yellow
  { t: 0.52, c: [240, 140, 30] }, // orange
  { t: 0.74, c: [222, 57, 31] }, // red
  { t: 1.0, c: [116, 26, 10] }, // umber
];

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Colour at severity position `t` ∈ [0,1] on the shared ramp. */
export function rampColor(t: number): RGB {
  if (Number.isNaN(t)) return [128, 128, 128];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i].t) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const f = (x - a.t) / (b.t - a.t);
      return [
        Math.round(lerp(a.c[0], b.c[0], f)),
        Math.round(lerp(a.c[1], b.c[1], f)),
        Math.round(lerp(a.c[2], b.c[2], f)),
      ];
    }
  }
  return RAMP[RAMP.length - 1].c;
}

// Piecewise value → severity position, by category, so the two indices' matching
// categories land at (roughly) the same colour.
function pieceT(value: number, anchors: [number, number][]): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    if (value <= anchors[i][0]) {
      const [v0, t0] = anchors[i - 1];
      const [v1, t1] = anchors[i];
      return t0 + ((t1 - t0) * (value - v0)) / (v1 - v0);
    }
  }
  return last[1];
}

// US AQI 0–500 and Canada's AQHI 1–10+ mapped onto the shared ramp by category.
const AQI_ANCHORS: [number, number][] = [[0, 0], [50, 0.2], [100, 0.4], [150, 0.55], [200, 0.72], [300, 0.88], [500, 1]];
const AQHI_ANCHORS: [number, number][] = [[1, 0], [3, 0.28], [6, 0.52], [10, 0.85], [11, 1]];

export function aqiColor(v: number): RGB {
  return rampColor(pieceT(v, AQI_ANCHORS));
}
export function aqhiColor(v: number): RGB {
  return rampColor(pieceT(v, AQHI_ANCHORS));
}

const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const aqiColorCss = (v: number) => css(aqiColor(v));
export const aqhiColorCss = (v: number) => css(aqhiColor(v));

// Overlay opacity: transparent while good / low-risk, fading to semi-opaque as air
// worsens. AQI is "good" up to 50; AQHI is "low" up to 3.
const SEMI_ALPHA = 0.6;
export function aqiAlpha(v: number): number {
  if (Number.isNaN(v) || v <= 50) return 0;
  if (v >= 100) return SEMI_ALPHA;
  return (SEMI_ALPHA * (v - 50)) / 50;
}
export function aqhiAlpha(v: number): number {
  if (Number.isNaN(v) || v <= 3) return 0;
  if (v >= 5) return SEMI_ALPHA;
  return (SEMI_ALPHA * (v - 3)) / 2;
}

export function airFieldColor(v: number, mode: AirMode): RGB {
  return mode === "aqi" ? aqiColor(v) : aqhiColor(v);
}
export function airFieldAlpha(v: number, mode: AirMode): number {
  return mode === "aqi" ? aqiAlpha(v) : aqhiAlpha(v);
}

/** Legend key (label + representative colour, from the ramp) per index. */
export const AQI_LEGEND: { label: string; max: number; color: string }[] = [
  { label: "Good", max: 50, color: aqiColorCss(25) },
  { label: "Moderate", max: 100, color: aqiColorCss(75) },
  { label: "Sensitive", max: 150, color: aqiColorCss(125) },
  { label: "Unhealthy", max: 200, color: aqiColorCss(175) },
  { label: "Very unhealthy", max: 300, color: aqiColorCss(250) },
  { label: "Hazardous", max: 500, color: aqiColorCss(400) },
];
export const AQHI_LEGEND: { label: string; max: number; color: string }[] = [
  { label: "Low", max: 3, color: aqhiColorCss(2) },
  { label: "Moderate", max: 6, color: aqhiColorCss(5) },
  { label: "High", max: 10, color: aqhiColorCss(8) },
  { label: "Very high", max: 11, color: aqhiColorCss(11) },
];
