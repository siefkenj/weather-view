// The °C/°F toggle affects temperature ONLY. Precipitation is always shown in mm
// (switching temperature units must not change the rain numbers). Open-Meteo is
// always requested in metric (°C, mm) and temperature is converted here.

export type Units = "metric" | "imperial";

export function cToDisplay(celsius: number, units: Units): number {
  return units === "imperial" ? celsius * 1.8 + 32 : celsius;
}

export const tempUnit = (units: Units): string => (units === "imperial" ? "°F" : "°C");
export const PRECIP_UNIT = "mm";

export function formatTemp(celsius: number | null | undefined, units: Units, digits = 0): string {
  if (celsius == null || !Number.isFinite(celsius)) return "–";
  return `${cToDisplay(celsius, units).toFixed(digits)}°`;
}

export function formatPrecip(mm: number | null | undefined): string {
  if (mm == null || !Number.isFinite(mm)) return "–";
  const digits = mm < 1 ? 2 : 1;
  return `${mm.toFixed(digits)} ${PRECIP_UNIT}`;
}
