// Moist-air psychrometrics: saturation vapor pressure, humidity ratio, specific
// enthalpy, and thermodynamic wet-bulb temperature.
//
// Inputs come straight from the hourly forecast: dry-bulb temperature (°C),
// relative humidity (%), and surface pressure (hPa). Enthalpy is reported per
// kilogram of DRY air (the psychrometric convention, since dry-air mass is
// conserved while volume is not) with the standard ASHRAE zero — dry air and
// liquid water both at 0 °C — so only *differences* in enthalpy are physical.

const CP_AIR = 1.006; // kJ/(kg·K) — specific heat of dry air
const CP_VAPOR = 1.86; // kJ/(kg·K) — specific heat of water vapor
const L0 = 2501; // kJ/kg — latent heat of vaporization at 0 °C
const MW_RATIO = 0.62198; // molar mass ratio, water vapor / dry air

/** Saturation vapor pressure over water, in hPa (Magnus/Tetens form). T in °C. */
export function saturationVaporPressure(tC: number): number {
  return 6.1094 * Math.exp((17.625 * tC) / (tC + 243.04));
}

/** Humidity ratio W — kg water vapor per kg dry air. NaN if inputs are unphysical. */
export function humidityRatio(tC: number, rhPct: number, pressureHpa: number): number {
  const pw = (rhPct / 100) * saturationVaporPressure(tC);
  const denom = pressureHpa - pw;
  if (!(denom > 0)) return NaN;
  return (MW_RATIO * pw) / denom;
}

/**
 * Specific enthalpy of moist air, kJ per kg of dry air. The first term is
 * sensible heat (temperature); the W·(…) term is latent heat carried by water
 * vapor, which dominates in warm, humid air.
 */
export function moistAirEnthalpy(tC: number, rhPct: number, pressureHpa: number): number {
  const w = humidityRatio(tC, rhPct, pressureHpa);
  if (!Number.isFinite(w)) return NaN;
  return CP_AIR * tC + w * (L0 + CP_VAPOR * tC);
}

/**
 * Thermodynamic (psychrometric) wet-bulb temperature, °C. Found by bisecting the
 * adiabatic-saturation relation with the *actual* station pressure, so it stays
 * correct at altitude — unlike sea-level-only closed-form fits (e.g. Stull).
 */
export function wetBulbTemperature(tC: number, rhPct: number, pressureHpa: number): number {
  const w = humidityRatio(tC, rhPct, pressureHpa);
  if (!Number.isFinite(w)) return NaN;

  // Humidity ratio that adiabatic saturation to `tw` would produce. Monotonically
  // increasing in `tw`, and equal to W at the true wet-bulb temperature.
  const wStar = (tw: number): number => {
    const pws = saturationVaporPressure(tw);
    const denom = pressureHpa - pws;
    if (!(denom > 0)) return Infinity;
    const ws = (MW_RATIO * pws) / denom;
    return ((L0 - 2.326 * tw) * ws - CP_AIR * (tC - tw)) / (L0 + CP_VAPOR * tC - 4.186 * tw);
  };

  // The root lies in [lo, tC] (wet bulb never exceeds dry bulb). -80 °C is a safe
  // floor for any real atmosphere; 60 bisections converge well past display precision.
  let lo = -80;
  let hi = tC;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (wStar(mid) > w) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
