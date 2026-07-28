// Subjective daylight shading for the mini graph. The sun's geometry gives the
// *physical* light; the eye adapts, so what we render is *perceived* brightness.
//
// Physical horizontal irradiance spans ~8 orders of magnitude from noon to
// night, but vision compresses that range (Weber–Fechner): dusk still reads
// bright, then perceived brightness collapses "suddenly" once the light falls
// past the retina's operating point. We reproduce that with a photoreceptor
// response (Naka–Rushton) applied to a twilight-extended light proxy — see
// perceivedBrightness. The solar declination is recovered from the day's
// sunrise/sunset and the latitude, so no timezone math is needed. Cloud cover
// and everything else are deliberately ignored — this is pure geometry.

function hoursOfDay(iso: string): number {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

const DEG = Math.PI / 180;

/**
 * sin(sun elevation) at each `time`, SIGNED (negative below the horizon, so
 * twilight is represented rather than clamped to dark). Peaks near
 * sin(90° − |lat − declination|) at solar noon. Returns null when the geometry
 * is degenerate (missing sun times, polar day/night, the equator).
 */
export function solarSinElevation(
  time: string[],
  sunriseIso: string | undefined,
  sunsetIso: string | undefined,
  latDeg: number,
): number[] | null {
  if (!sunriseIso || !sunsetIso || time.length === 0) return null;
  const sr = hoursOfDay(sunriseIso);
  const ss = hoursOfDay(sunsetIso);
  const dayLen = ss - sr;
  if (!(dayLen > 0 && dayLen < 24)) return null;

  const lat = latDeg * DEG;
  const tanLat = Math.tan(lat);
  if (Math.abs(tanLat) < 1e-4) return null; // equator: declination indeterminate here

  const noon = (sr + ss) / 2;
  // Sunset hour angle H0 satisfies cos(H0) = -tan(lat)·tan(decl) at elevation 0.
  const H0 = (dayLen / 2) * 15 * DEG;
  const decl = Math.atan(-Math.cos(H0) / tanLat);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinDecl = Math.sin(decl);
  const cosDecl = Math.cos(decl);

  // Continuous local hour, so a 2am→2am window crosses midnight monotonically.
  let prev = -Infinity;
  let add = 0;
  return time.map((t) => {
    let h = hoursOfDay(t) + add;
    if (h < prev) {
      add += 24;
      h += 24;
    }
    prev = h;
    const H = (h - noon) * 15 * DEG;
    return sinLat * sinDecl + cosLat * cosDecl * Math.cos(H);
  });
}

// ---- Perceptual (subjective) brightness model -------------------------------

/** Diffuse skylight remaining at the horizon, relative to overhead sun (≈ 1). */
const SKYLIGHT = 0.02;
/** e-folding of skylight per radian the sun sinks below the horizon (~5°/decade). */
const TWILIGHT_DECAY = 5 * DEG;
/** Naka–Rushton exponent: how sharp the twilight knee is. */
const NR_EXP = 1.5;

/**
 * Relative horizontal light for a given solar elevation (radians): direct sun
 * above the horizon, plus a skylight term that decays exponentially as the sun
 * sinks below it (so there's a smooth twilight instead of an instant cutoff).
 */
function lightProxy(hRad: number): number {
  return Math.max(0, Math.sin(hRad)) + SKYLIGHT * Math.exp(Math.min(hRad, 0) / TWILIGHT_DECAY);
}

/**
 * Semi-saturation constant, pinned to the end of civil twilight (sun 6° below
 * the horizon): perceived brightness passes through 0.5 there and plunges below.
 */
const NR_SIGMA = lightProxy(-6 * DEG);

/**
 * Perceived (subjective) brightness in 0..1 from the sun's signed sin-elevation.
 * The Naka–Rushton response saturates near 1 across the whole bright range — so
 * even a low evening sun still reads bright — then drops sharply through the
 * twilight knee, giving the abrupt "night falls" transition.
 */
export function perceivedBrightness(sinElev: number): number {
  const hRad = Math.asin(Math.max(-1, Math.min(1, sinElev)));
  const i = lightProxy(hRad) ** NR_EXP;
  return i / (i + NR_SIGMA ** NR_EXP);
}

export interface DaylightStop {
  /** Position across the window, 0..100 (%). */
  offset: number;
  /** Perceived brightness, 0..1. */
  brightness: number;
}

/**
 * Perceived-brightness gradient stops across the window. The sun's elevation is
 * smooth (per-`time` sampling is plenty for it), but the perceptual knee at
 * twilight is sharp — so we evaluate the Naka–Rushton response at a finer
 * resolution than the data, linearly interpolating elevation between samples.
 * That keeps the fast dusk fade smooth instead of rendering as a hard step when
 * `time` is only hourly. Returns null on degenerate geometry.
 */
export function daylightBrightnessStops(
  time: string[],
  sunriseIso: string | undefined,
  sunsetIso: string | undefined,
  latDeg: number,
  samples = 64,
): DaylightStop[] | null {
  const sinElev = solarSinElevation(time, sunriseIso, sunsetIso, latDeg);
  if (!sinElev) return null;
  const n = sinElev.length;
  if (n < 2) return null;

  const stops: DaylightStop[] = [];
  for (let k = 0; k <= samples; k++) {
    const u = k / samples;
    const f = u * (n - 1);
    const lo = Math.min(n - 2, Math.floor(f));
    const frac = f - lo;
    // Elevation is ~linear over one step; the nonlinearity is applied here, fine.
    const s = sinElev[lo] + (sinElev[lo + 1] - sinElev[lo]) * frac;
    stops.push({ offset: u * 100, brightness: perceivedBrightness(s) });
  }
  return stops;
}
