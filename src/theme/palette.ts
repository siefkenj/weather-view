// Chart colors, resolved per theme. Series hues mirror the reference screenshot
// (temp = red, feels-like = magenta, dew = green, precip = blue).

import type { Theme } from "../hooks/useTheme";

export interface ChartPalette {
  temp: string;
  feels: string;
  dew: string;
  wetbulb: string;
  enthalpy: string;
  precip: string;
  precipProb: string;
  cloud: string;
  humidity: string;
  pressure: string;
  radiation: string;
  bandTemp: string;
  bandPrecip: string;
  axisLine: string;
  axisLabel: string;
  splitLine: string;
  tooltipBg: string;
  tooltipText: string;
  nowLine: string;
  dayShade: string;
  weekendShade: string;
}

const SERIES = {
  temp: "#e03131",
  feels: "#c2255c",
  dew: "#2f9e44",
  // Wet bulb reads "cool/wet" (teal); enthalpy is a total-energy measure on its
  // own axis (violet).
  wetbulb: "#0c8599",
  enthalpy: "#7048e8",
  precip: "#1c7ed6",
  precipProb: "#4dabf7",
  humidity: "#40b06a",
  pressure: "#495057",
  radiation: "#f59f00",
};

export function chartPalette(theme: Theme): ChartPalette {
  const dark = theme === "dark";
  return {
    ...SERIES,
    pressure: dark ? "#ced4da" : "#343a40",
    cloud: dark ? "rgba(148,163,184,0.45)" : "rgba(120,130,145,0.35)",
    bandTemp: dark ? "rgba(224,49,49,0.20)" : "rgba(224,49,49,0.16)",
    bandPrecip: dark ? "rgba(28,126,214,0.28)" : "rgba(28,126,214,0.20)",
    axisLine: dark ? "#3a4560" : "#d7dde8",
    axisLabel: dark ? "#9aa6be" : "#6b7688",
    splitLine: dark ? "rgba(120,135,165,0.16)" : "rgba(120,135,165,0.18)",
    tooltipBg: dark ? "rgba(20,27,45,0.96)" : "rgba(255,255,255,0.98)",
    tooltipText: dark ? "#e6eaf2" : "#1f2733",
    nowLine: dark ? "#f8f9fa" : "#212529",
    dayShade: dark ? "rgba(255,255,255,0.035)" : "rgba(20,30,60,0.035)",
    // Weekends get a distinct indigo tint so they read differently from the
    // neutral weekday stripes.
    weekendShade: dark ? "rgba(129,140,248,0.15)" : "rgba(99,102,241,0.11)",
  };
}
