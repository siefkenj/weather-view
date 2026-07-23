// Relative daylight intensity (0..1) from the sun's elevation angle, used to
// shade the mini graph's background. The solar declination is recovered from the
// day's sunrise/sunset and the latitude, so no timezone math is needed. Cloud
// cover and everything else are deliberately ignored — this is pure geometry.

function hoursOfDay(iso: string): number {
  return Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
}

/**
 * sin(sun elevation) at each `time`, clamped to ≥0 (below the horizon = dark).
 * Peaks near sin(90° − |lat − declination|) at solar noon. Returns null when the
 * geometry is degenerate (missing sun times, polar day/night, the equator).
 */
export function daylightIntensity(
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

  const rad = Math.PI / 180;
  const lat = latDeg * rad;
  const tanLat = Math.tan(lat);
  if (Math.abs(tanLat) < 1e-4) return null; // equator: declination indeterminate here

  const noon = (sr + ss) / 2;
  // Sunset hour angle H0 satisfies cos(H0) = -tan(lat)·tan(decl) at elevation 0.
  const H0 = (dayLen / 2) * 15 * rad;
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
    const H = (h - noon) * 15 * rad;
    return Math.max(0, sinLat * sinDecl + cosLat * cosDecl * Math.cos(H));
  });
}
