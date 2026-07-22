// WMO weather interpretation codes (WW) → human label + icon category.
// Reference table: https://open-meteo.com/en/docs

export type IconKind =
  | "clear"
  | "mainly-clear"
  | "partly-cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "snow-grains"
  | "rain-showers"
  | "snow-showers"
  | "thunderstorm"
  | "thunderstorm-hail";

export interface WeatherDescription {
  code: number;
  label: string;
  icon: IconKind;
  /** Thunderstorm / heavy conditions worth flagging in the UI. */
  severe: boolean;
}

const TABLE: Record<number, Omit<WeatherDescription, "code">> = {
  0: { label: "Clear sky", icon: "clear", severe: false },
  1: { label: "Mainly clear", icon: "mainly-clear", severe: false },
  2: { label: "Partly cloudy", icon: "partly-cloudy", severe: false },
  3: { label: "Overcast", icon: "overcast", severe: false },
  45: { label: "Fog", icon: "fog", severe: false },
  48: { label: "Rime fog", icon: "fog", severe: false },
  51: { label: "Light drizzle", icon: "drizzle", severe: false },
  53: { label: "Drizzle", icon: "drizzle", severe: false },
  55: { label: "Dense drizzle", icon: "drizzle", severe: false },
  56: { label: "Freezing drizzle", icon: "freezing-rain", severe: false },
  57: { label: "Dense freezing drizzle", icon: "freezing-rain", severe: false },
  61: { label: "Slight rain", icon: "rain", severe: false },
  63: { label: "Rain", icon: "rain", severe: false },
  65: { label: "Heavy rain", icon: "rain", severe: true },
  66: { label: "Freezing rain", icon: "freezing-rain", severe: false },
  67: { label: "Heavy freezing rain", icon: "freezing-rain", severe: true },
  71: { label: "Slight snow", icon: "snow", severe: false },
  73: { label: "Snow", icon: "snow", severe: false },
  75: { label: "Heavy snow", icon: "snow", severe: true },
  77: { label: "Snow grains", icon: "snow-grains", severe: false },
  80: { label: "Slight rain showers", icon: "rain-showers", severe: false },
  81: { label: "Rain showers", icon: "rain-showers", severe: false },
  82: { label: "Violent rain showers", icon: "rain-showers", severe: true },
  85: { label: "Slight snow showers", icon: "snow-showers", severe: false },
  86: { label: "Heavy snow showers", icon: "snow-showers", severe: true },
  95: { label: "Thunderstorm", icon: "thunderstorm", severe: true },
  96: { label: "Thunderstorm with hail", icon: "thunderstorm-hail", severe: true },
  99: { label: "Thunderstorm with heavy hail", icon: "thunderstorm-hail", severe: true },
};

const UNKNOWN: Omit<WeatherDescription, "code"> = {
  label: "Unknown",
  icon: "overcast",
  severe: false,
};

export function describeWeather(code: number): WeatherDescription {
  return { code, ...(TABLE[code] ?? UNKNOWN) };
}
