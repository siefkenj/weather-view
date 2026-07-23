import { describe, expect, it } from "vitest";
import { buildMeteogramOption } from "./meteogramOption";
import { chartPalette } from "../theme/palette";
import type { HourlyPoint } from "../utils/series";
import type { Bands } from "../api/ensemble";

function sampleHourly(hours = 48): HourlyPoint {
  const time: string[] = [];
  for (let i = 0; i < hours; i++) {
    const day = 22 + Math.floor(i / 24);
    const hh = String(i % 24).padStart(2, "0");
    time.push(`2026-07-${day}T${hh}:00`);
  }
  const fill = (fn: (i: number) => number) => time.map((_, i) => fn(i));
  return {
    time,
    temperature: fill((i) => 18 + Math.sin(i / 4) * 6),
    apparent: fill((i) => 17 + Math.sin(i / 4) * 6),
    dewPoint: fill(() => 12),
    precipitation: fill((i) => (i % 8 === 0 ? 1.2 : 0)),
    precipProbability: fill((i) => (i % 8 === 0 ? 60 : 10)),
    humidity: fill(() => 70),
    cloudCover: fill((i) => 40 + (i % 10) * 3),
    pressure: fill(() => 1012),
    radiation: fill(() => 200),
  };
}

const seriesNames = (opt: ReturnType<typeof buildMeteogramOption>) =>
  (opt.series as { name: string }[]).map((s) => s.name);

describe("buildMeteogramOption", () => {
  const base = {
    hourly: sampleHourly(),
    palette: chartPalette("light"),
    units: "metric" as const,
    series: ["temp", "feels", "dew"] as const,
    panels: ["precip", "atmo", "air"] as const,
    nowIso: "2026-07-22T11:00",
  };

  it("builds three stacked grids with all panels enabled", () => {
    const opt = buildMeteogramOption({ ...base, series: [...base.series], panels: [...base.panels] });
    expect(opt.grid).toHaveLength(3);
    const names = seriesNames(opt);
    expect(names).toContain("Temperature");
    expect(names).toContain("Precipitation");
    expect(names).toContain("Cloud cover");
    expect(names).toContain("Pressure");
  });

  it("drops panels and series that are toggled off", () => {
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: ["precip"] });
    expect(opt.grid).toHaveLength(2); // temp + precip only
    const names = seriesNames(opt);
    expect(names).toContain("Temperature");
    expect(names).not.toContain("Feels like");
    expect(names).not.toContain("Cloud cover");
  });

  it("adds confidence-band series when bands are supplied", () => {
    const band: Bands = {
      time: base.hourly.time,
      lower: base.hourly.temperature.map((v) => v - 2),
      median: base.hourly.temperature,
      upper: base.hourly.temperature.map((v) => v + 2),
    };
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: ["precip"], tempBand: band });
    expect(seriesNames(opt)).toContain("_tempBand");
  });

  it("adds wet-bulb and enthalpy series (with a kJ/kg right axis) when selected", () => {
    const opt = buildMeteogramOption({
      ...base,
      series: ["temp", "wetbulb", "enthalpy"],
      panels: [],
    });
    const names = seriesNames(opt);
    expect(names).toContain("Wet bulb");
    expect(names).toContain("Enthalpy");
    // Enthalpy gets its own value axis named kJ/kg.
    const axisNames = (opt.yAxis as { name?: string }[]).map((a) => a.name);
    expect(axisNames).toContain("kJ/kg");
  });

  it("computes plausible enthalpy values from temperature/humidity/pressure", () => {
    const opt = buildMeteogramOption({ ...base, series: ["enthalpy"], panels: [] });
    const enth = (opt.series as { name: string; data: number[] }[]).find((s) => s.name === "Enthalpy");
    // 18 °C ± 6 at 70% RH, 1012 hPa lands in the ~35–70 kJ/kg range of moist air.
    expect(Math.min(...enth!.data)).toBeGreaterThan(25);
    expect(Math.max(...enth!.data)).toBeLessThan(90);
  });

  it("converts temperature to imperial when requested", () => {
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: [], units: "imperial" });
    const temp = (opt.series as { name: string; data: number[] }[]).find((s) => s.name === "Temperature");
    // ~18°C sample should land in a Fahrenheit range well above 32.
    expect(Math.max(...temp!.data)).toBeGreaterThan(50);
  });

  it("adds an AQHI air panel (with band-coloring visualMap) when aqhi data is supplied", () => {
    const aqhi = base.hourly.time.map((_, i) => 2 + (i % 6));
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: ["air"], aqhi });
    expect(opt.grid).toHaveLength(2); // temp + air
    expect(seriesNames(opt)).toContain("Air quality");
    expect(opt.visualMap).toBeTruthy();
  });

  it("omits the air panel when no aqhi data is supplied", () => {
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: ["air"] });
    expect(opt.grid).toHaveLength(1); // temp only
    expect(seriesNames(opt)).not.toContain("Air quality");
  });

  it("shows chance-of-precip only from the current time forward", () => {
    const opt = buildMeteogramOption({
      ...base,
      series: ["temp"],
      panels: ["precip"],
      currentIso: "2026-07-22T12:00",
    });
    // Past/forecast split → the forecast segment is the last "Chance of precip".
    const probs = (opt.series as { name: string; data: number[] }[]).filter((s) => s.name === "Chance of precip");
    const fut = probs[probs.length - 1];
    // Sample runs 2026-07-22T00:00…; hours before noon must be blanked (NaN).
    expect(Number.isNaN(fut.data[0])).toBe(true);
    expect(Number.isFinite(fut.data[base.hourly.time.length - 1])).toBe(true);
  });

  it("splits temperature into a thin past and a thick forecast line at currentIso", () => {
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: [], currentIso: "2026-07-22T12:00" });
    const temps = (opt.series as { name: string; lineStyle?: { width?: number } }[]).filter((s) => s.name === "Temperature");
    expect(temps).toHaveLength(2);
    const widths = temps.map((s) => s.lineStyle?.width ?? 0).sort((a, b) => a - b);
    expect(widths[0]).toBeLessThan(widths[1]); // past thinner than forecast
  });
});
