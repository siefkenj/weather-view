// US AQI category bands (EPA). Used to label and color the air-quality panel.

export interface AqiCategory {
  label: string;
  /** Accessible-ish color used for chips/meters in both themes. */
  color: string;
  min: number;
  max: number;
}

const US_AQI_BANDS: AqiCategory[] = [
  { label: "Good", color: "#2ecc71", min: 0, max: 50 },
  { label: "Moderate", color: "#f1c40f", min: 51, max: 100 },
  { label: "Unhealthy for sensitive groups", color: "#e67e22", min: 101, max: 150 },
  { label: "Unhealthy", color: "#e74c3c", min: 151, max: 200 },
  { label: "Very unhealthy", color: "#9b59b6", min: 201, max: 300 },
  { label: "Hazardous", color: "#7e0023", min: 301, max: Infinity },
];

export function usAqiCategory(aqi: number | null | undefined): AqiCategory {
  if (aqi == null || !Number.isFinite(aqi)) return US_AQI_BANDS[0];
  return US_AQI_BANDS.find((b) => aqi >= b.min && aqi <= b.max) ?? US_AQI_BANDS[US_AQI_BANDS.length - 1];
}

export const US_AQI_LEGEND = US_AQI_BANDS;
