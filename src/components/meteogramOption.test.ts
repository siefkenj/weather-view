import { describe, expect, it } from "vitest";
import { buildMeteogramOption, meteogramLegend, seriesColor } from "./meteogramOption";
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

  const tempLines = (opt: ReturnType<typeof buildMeteogramOption>) =>
    (opt.series as { name: string; lineStyle?: { width?: number } }[]).filter((s) => s.name === "Temperature");

  it("draws a single THICK forecast line when the whole window is in the future", () => {
    // currentIso before the sample window → every point is forecast.
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: [], currentIso: "2026-07-20T00:00" });
    const temps = tempLines(opt);
    expect(temps).toHaveLength(1);
    expect(temps[0].lineStyle?.width).toBe(2); // base width, not thinned
  });

  it("draws a single THIN line when the whole window is in the past", () => {
    // currentIso after the sample window → every point has already happened.
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: [], currentIso: "2026-07-30T00:00" });
    const temps = tempLines(opt);
    expect(temps).toHaveLength(1);
    expect(temps[0].lineStyle?.width).toBeLessThan(2); // thinned (past)
  });

  it("colours series and legend from one central map, unaffected by CI bands", () => {
    const palette = chartPalette("light");
    const central = seriesColor(palette);
    const band: Bands = {
      time: base.hourly.time,
      lower: base.hourly.temperature.map((v) => v - 2),
      median: base.hourly.temperature,
      upper: base.hourly.temperature.map((v) => v + 2),
    };
    // Build WITH confidence bands (which insert extra series ahead of the lines).
    const opt = buildMeteogramOption({
      ...base,
      series: ["temp"],
      panels: ["precip", "atmo"],
      tempBand: band,
      precipBand: band,
    });
    const series = opt.series as { name: string; lineStyle?: { color?: string }; itemStyle?: { color?: string } }[];
    const colorOf = (name: string) => {
      const s = series.find((x) => x.name === name);
      return s?.itemStyle?.color ?? s?.lineStyle?.color;
    };
    // The dots the tooltip renders come from `central`; the series must match it,
    // and cloud/chance-of-precip are exactly the ones that used to drift with CI.
    expect(colorOf("Chance of precip")).toBe(central["Chance of precip"]);
    expect(colorOf("Cloud cover")).toBe(central["Cloud cover"]);
    expect(colorOf("Humidity")).toBe(central.Humidity);

    // The legend reads from the same map.
    const legend = meteogramLegend({ panels: ["precip", "atmo"], palette });
    expect(legend.find((l) => l.name === "Chance of precip")?.color).toBe(central["Chance of precip"]);
    expect(legend.find((l) => l.name === "Cloud cover")?.color).toBe(central["Cloud cover"]);
  });

  it("appends a ± confidence range to the temperature tooltip (half the band width)", () => {
    // Asymmetric band: 2° below, 4° above the prediction → avg deviation = 3°.
    const band: Bands = {
      time: base.hourly.time,
      lower: base.hourly.temperature.map((v) => v - 2),
      median: base.hourly.temperature,
      upper: base.hourly.temperature.map((v) => v + 4),
    };
    const withBand = buildMeteogramOption({ ...base, series: ["temp"], panels: [], tempBand: band });
    const fmt = (withBand.tooltip as { formatter: (p: unknown) => string }).formatter;
    const html = fmt([
      { seriesName: "Temperature", value: 20, color: "#f00", axisValue: base.hourly.time[3], dataIndex: 3 },
    ]);
    expect(html).toContain("± 3");

    // No band → no ± range.
    const noBand = buildMeteogramOption({ ...base, series: ["temp"], panels: [] });
    const fmt2 = (noBand.tooltip as { formatter: (p: unknown) => string }).formatter;
    const html2 = fmt2([
      { seriesName: "Temperature", value: 20, color: "#f00", axisValue: base.hourly.time[3], dataIndex: 3 },
    ]);
    expect(html2).not.toContain("±");
  });

  it("collapses the confidence band for observed (past) hours, keeping it in the forecast", () => {
    const band: Bands = {
      time: base.hourly.time,
      lower: base.hourly.temperature.map((v) => v - 2),
      median: base.hourly.temperature,
      upper: base.hourly.temperature.map((v) => v + 2),
    };
    // Sample runs 2026-07-22T00:00…; "now" at noon of day 1 → nowIdx = 12.
    const opt = buildMeteogramOption({
      ...base,
      series: ["temp"],
      panels: [],
      tempBand: band,
      currentIso: "2026-07-22T12:00",
    });
    const bandData = (opt.series as { name: string; data: number[] }[]).find((s) => s.name === "_tempBand")!.data;
    expect(Number.isNaN(bandData[5])).toBe(true); // past hour → no band
    expect(Number.isFinite(bandData[20])).toBe(true); // forecast hour → band
  });

  it("normalizes precipitation to a mm/h rate regardless of the grid step", () => {
    const mkRow = (opt: ReturnType<typeof buildMeteogramOption>) =>
      (opt.tooltip as { formatter: (p: unknown) => string }).formatter([
        { seriesName: "Precipitation", value: 1.1, color: "#00f", axisValue: base.hourly.time[3], dataIndex: 3 },
      ]);
    // Hourly grid: value is already per-hour.
    expect(mkRow(buildMeteogramOption({ ...base, series: ["temp"], panels: ["precip"] }))).toContain("1.1 mm/h");

    // Same value on a 15-minute grid: 1.1 mm/15-min → 4.4 mm/h.
    const fifteen: HourlyPoint = {
      ...base.hourly,
      time: base.hourly.time.map((_, i) => `2026-07-22T${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`),
    };
    const opt15 = buildMeteogramOption({ ...base, hourly: fifteen, series: ["temp"], panels: ["precip"] });
    expect(mkRow(opt15)).toContain("4.4 mm/h");
  });

  it("lists tooltip rows in a stable canonical order regardless of param order", () => {
    const opt = buildMeteogramOption({ ...base, series: ["temp"], panels: ["precip", "atmo"] });
    const fmt = (opt.tooltip as { formatter: (p: unknown) => string }).formatter;
    const mk = (seriesName: string, value: number) => ({ seriesName, value, color: "#000", axisValue: base.hourly.time[3], dataIndex: 3 });
    // Feed params out of order; the output must still be canonical.
    const html = fmt([mk("Humidity", 50), mk("Pressure", 1010), mk("Precipitation", 1), mk("Temperature", 20)]);
    const order = ["Temperature", "Precipitation", "Humidity", "Pressure"].map((n) => html.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly increasing
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("suppresses hover symbols on the invisible confidence-band envelope series", () => {
    const band: Bands = {
      time: base.hourly.time,
      lower: base.hourly.temperature.map((v) => v - 2),
      median: base.hourly.temperature,
      upper: base.hourly.temperature.map((v) => v + 2),
    };
    const opt = buildMeteogramOption({
      ...base,
      series: ["temp"],
      panels: ["precip"],
      tempBand: band,
      precipBand: band,
    });
    // The band envelope lines have no colour of their own; without symbol:"none"
    // ECharts draws palette-coloured dots on them at the hovered point.
    const envelopes = (opt.series as { name: string; symbol?: string }[]).filter((s) =>
      ["_tempLo", "_tempBand", "_precipLo", "_precipBand"].includes(s.name),
    );
    expect(envelopes).toHaveLength(4);
    expect(envelopes.every((s) => s.symbol === "none")).toBe(true);
  });
});
