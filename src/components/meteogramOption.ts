// Builds the stacked-panel meteogram ECharts option:
//   panel 1 — temperature / feels-like / dew-point (+ optional confidence band)
//   panel 2 — precipitation bars + chance-of-precip line (+ optional band)
//   panel 3 — cloud cover / humidity / pressure
// Panels share a linked time axis so one crosshair scrubs all of them.

import type { EChartsOption, SeriesOption } from "echarts";
import type { Bands } from "../api/ensemble";
import type { ChartPalette } from "../theme/palette";
import type { PanelKey, SeriesKey } from "../hooks/useUrlState";
import { cToDisplay, PRECIP_UNIT, tempUnit, type Units } from "../utils/units";
import { moistAirEnthalpy, wetBulbTemperature } from "../utils/psychro";
import { formatDayShort, formatTime } from "../utils/format";
import { dayShadeMarkArea } from "./meteogramShading";
import { computeHorizontalLayout, TEMP_HEADROOM } from "./meteogramLayout";
import type { HourlyPoint } from "../utils/series";

export interface MeteogramInput {
  hourly: HourlyPoint;
  palette: ChartPalette;
  units: Units;
  series: SeriesKey[];
  panels: PanelKey[];
  tempBand?: Bands | null;
  precipBand?: Bands | null;
  nowIso?: string | null;
  /** Add empty space at the top of the temp panel for the on-graph day tiles. */
  headroom?: boolean;
  /** Live accessor for the currently hovered series name (bolded in the tooltip). */
  getHovered?: () => string | null;
}

const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN);

export function buildMeteogramOption(input: MeteogramInput): EChartsOption {
  const { hourly, palette, units, series, panels, tempBand, precipBand, nowIso } = input;
  const time = hourly.time;

  const showPrecip = panels.includes("precip");
  const showAtmo = panels.includes("atmo");

  // ---- Panel layout (percentages) --------------------------------------
  const { panelKeys: panelList, grids: gridBoxes } = computeHorizontalLayout(panels);

  const grids: EChartsOption["grid"] = gridBoxes.map((g) => ({
    left: 56,
    right: 56,
    top: `${g.top}%`,
    height: `${g.height}%`,
  }));
  const gridIndex = Object.fromEntries(panelList.map((p, i) => [p, i]));
  const lastGrid = panelList.length - 1;

  const dayLabel = {
    color: palette.axisLabel,
    // Label at noon so the date sits centered over its day (aligned with the tiles).
    interval: (_idx: number, value: string) => value.slice(11, 13) === "12",
    formatter: (value: string) => formatDayShort(value),
    hideOverlap: true,
  };

  // ---- Axes ------------------------------------------------------------
  const xAxis: EChartsOption["xAxis"] = panelList.map((_key, i) => ({
    type: "category",
    data: time,
    gridIndex: i,
    boundaryGap: false,
    axisLine: { lineStyle: { color: palette.axisLine } },
    axisTick: { show: false },
    axisLabel: i === lastGrid ? dayLabel : { show: false },
    axisPointer: { label: { formatter: (p: { value: unknown }) => tooltipHeader(String(p.value)) } },
  }));

  const yAxes: EChartsOption["yAxis"] = [];
  const yIdx: Record<string, number> = {};
  const pushY = (key: string, def: object) => {
    yIdx[key] = (yAxes as object[]).length;
    (yAxes as object[]).push(def);
  };
  const yBase = (gi: number) => ({
    gridIndex: gi,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.splitLine } },
    axisLabel: { color: palette.axisLabel },
  });

  pushY("temp", {
    ...yBase(gridIndex.temp),
    name: input.headroom ? "" : tempUnit(units),
    nameTextStyle: { color: palette.axisLabel },
    scale: true,
    ...(input.headroom
      ? {
          min: (v: { min: number; max: number }) => v.min - (v.max - v.min) * TEMP_HEADROOM.bottom,
          max: (v: { min: number; max: number }) => v.max + (v.max - v.min) * TEMP_HEADROOM.top,
          // Explicit range disables "nice" endpoints, so hide the ragged
          // boundary labels and keep only the clean interior ticks.
          axisLabel: { color: palette.axisLabel, showMinLabel: false, showMaxLabel: false },
        }
      : {}),
  });
  // Enthalpy lives on its own right-hand axis (kJ/kg): a different unit from the
  // °-scale left axis, auto-scaled so the curve fills the panel to roughly the
  // same height as temperature — same pattern as pressure in the atmo panel.
  if (series.includes("enthalpy")) {
    pushY("enthalpy", {
      ...yBase(gridIndex.temp),
      name: "kJ/kg",
      position: "right",
      scale: true,
      splitLine: { show: false },
      nameTextStyle: { color: palette.enthalpy },
      axisLabel: { color: palette.enthalpy },
    });
  }
  if (showPrecip) {
    pushY("precip", { ...yBase(gridIndex.precip), name: PRECIP_UNIT, min: 0, nameTextStyle: { color: palette.axisLabel } });
    pushY("prob", { ...yBase(gridIndex.precip), min: 0, max: 100, position: "right", splitLine: { show: false }, axisLabel: { color: palette.precipProb, formatter: "{value}%" } });
  }
  if (showAtmo) {
    pushY("pct", { ...yBase(gridIndex.atmo), min: 0, max: 100, axisLabel: { color: palette.axisLabel, formatter: "{value}%" } });
    pushY("pressure", { ...yBase(gridIndex.atmo), position: "right", scale: true, splitLine: { show: false }, axisLabel: { color: palette.pressure, formatter: "{value}" } });
  }

  // ---- Series ----------------------------------------------------------
  const seriesList: SeriesOption[] = [];
  const shade = dayShadeMarkArea(time, palette, "xAxis");
  const firstOfPanel = new Set<number>();
  // Emphasis off everywhere (see the line() helper); hover bolding is manual.
  const lineEmph = { disabled: true as const };

  const line = (
    name: string,
    data: number[],
    color: string,
    gi: number,
    yi: number,
    extra: Partial<SeriesOption> = {},
  ): SeriesOption => {
    const attachShade = !firstOfPanel.has(gi);
    firstOfPanel.add(gi);
    return {
      name,
      type: "line",
      data,
      xAxisIndex: gi,
      yAxisIndex: yi,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      // ECharts emphasis is disabled: the axis tooltip would otherwise bold every
      // series at once. The one hovered line is thickened imperatively instead.
      emphasis: { disabled: true },
      ...(attachShade ? { markArea: shade } : {}),
      ...extra,
    } as SeriesOption;
  };

  // Temperature confidence band (drawn under the lines).
  if (tempBand && series.includes("temp")) {
    const lo = tempBand.lower.map((v) => round1(cToDisplay(v, units)));
    const width = tempBand.upper.map((v, i) => round1(cToDisplay(v, units) - cToDisplay(tempBand.lower[i], units)));
    seriesList.push({
      name: "_tempLo",
      type: "line",
      data: lo,
      xAxisIndex: gridIndex.temp,
      yAxisIndex: yIdx.temp,
      stack: "tband",
      lineStyle: { opacity: 0 },
      showSymbol: false,
      silent: true,
    });
    seriesList.push({
      name: "_tempBand",
      type: "line",
      data: width,
      xAxisIndex: gridIndex.temp,
      yAxisIndex: yIdx.temp,
      stack: "tband",
      lineStyle: { opacity: 0 },
      areaStyle: { color: palette.bandTemp },
      showSymbol: false,
      silent: true,
    });
  }

  const nowMark = nowIso
    ? {
        symbol: "none",
        silent: true,
        lineStyle: { color: palette.nowLine, type: "dashed" as const, width: 1.5 },
        label: { show: true, formatter: "now", color: palette.nowLine, position: "start" as const },
        data: [{ xAxis: nowIso.slice(0, 13) + ":00" }],
      }
    : undefined;

  if (series.includes("temp")) {
    seriesList.push(
      line("Temperature", hourly.temperature.map((v) => round1(cToDisplay(v, units))), palette.temp, gridIndex.temp, yIdx.temp, {
        z: 5,
        ...(nowMark ? { markLine: nowMark } : {}),
      }),
    );
  }
  if (series.includes("feels")) {
    seriesList.push(line("Feels like", hourly.apparent.map((v) => round1(cToDisplay(v, units))), palette.feels, gridIndex.temp, yIdx.temp, { lineStyle: { color: palette.feels, width: 1.6, type: "solid" } }));
  }
  if (series.includes("dew")) {
    seriesList.push(line("Dew point", hourly.dewPoint.map((v) => round1(cToDisplay(v, units))), palette.dew, gridIndex.temp, yIdx.temp, { lineStyle: { color: palette.dew, width: 1.6 } }));
  }
  if (series.includes("wetbulb")) {
    const wb = hourly.temperature.map((t, i) => round1(cToDisplay(wetBulbTemperature(t, hourly.humidity[i], hourly.pressure[i]), units)));
    seriesList.push(line("Wet bulb", wb, palette.wetbulb, gridIndex.temp, yIdx.temp, { lineStyle: { color: palette.wetbulb, width: 1.6 } }));
  }
  if (series.includes("enthalpy")) {
    const en = hourly.temperature.map((t, i) => round1(moistAirEnthalpy(t, hourly.humidity[i], hourly.pressure[i])));
    seriesList.push(line("Enthalpy", en, palette.enthalpy, gridIndex.temp, yIdx.enthalpy, { lineStyle: { color: palette.enthalpy, width: 1.6 } }));
  }

  // Precipitation panel.
  if (showPrecip) {
    if (precipBand) {
      const lo = precipBand.lower.map((v) => round1(Math.max(0, v)));
      const width = precipBand.upper.map((v, i) => round1(Math.max(0, v) - Math.max(0, precipBand.lower[i])));
      seriesList.push({ name: "_precipLo", type: "line", data: lo, xAxisIndex: gridIndex.precip, yAxisIndex: yIdx.precip, stack: "pband", lineStyle: { opacity: 0 }, showSymbol: false, silent: true });
      seriesList.push({ name: "_precipBand", type: "line", data: width, xAxisIndex: gridIndex.precip, yAxisIndex: yIdx.precip, stack: "pband", lineStyle: { opacity: 0 }, areaStyle: { color: palette.bandPrecip }, showSymbol: false, silent: true });
    }
    firstOfPanel.add(gridIndex.precip); // shade already on temp; keep precip clean
    seriesList.push({
      name: "Precipitation",
      type: "bar",
      data: hourly.precipitation.map((v) => round1(v)),
      xAxisIndex: gridIndex.precip,
      yAxisIndex: yIdx.precip,
      itemStyle: { color: palette.precip },
      emphasis: { disabled: true },
      barMaxWidth: 6,
      z: 3,
    });
    seriesList.push({
      name: "Chance of precip",
      type: "line",
      data: hourly.precipProbability,
      xAxisIndex: gridIndex.precip,
      yAxisIndex: yIdx.prob,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color: palette.precipProb, width: 1.6 },
      itemStyle: { color: palette.precipProb },
      areaStyle: { color: palette.bandPrecip, opacity: 0.35 },
      emphasis: lineEmph,
    });
  }

  // Atmosphere panel.
  if (showAtmo) {
    firstOfPanel.add(gridIndex.atmo);
    seriesList.push({
      name: "Cloud cover",
      type: "line",
      data: hourly.cloudCover,
      xAxisIndex: gridIndex.atmo,
      yAxisIndex: yIdx.pct,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color: palette.cloud, width: 0 },
      areaStyle: { color: palette.cloud },
      emphasis: lineEmph,
      z: 1,
    });
    seriesList.push({
      name: "Humidity",
      type: "line",
      data: hourly.humidity,
      xAxisIndex: gridIndex.atmo,
      yAxisIndex: yIdx.pct,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color: palette.humidity, width: 1.8 },
      itemStyle: { color: palette.humidity },
      emphasis: lineEmph,
    });
    seriesList.push({
      name: "Pressure",
      type: "line",
      data: hourly.pressure.map(round1),
      xAxisIndex: gridIndex.atmo,
      yAxisIndex: yIdx.pressure,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color: palette.pressure, width: 1.8 },
      itemStyle: { color: palette.pressure },
      emphasis: lineEmph,
    });
  }

  // ---- Tooltip ---------------------------------------------------------
  const unitFor: Record<string, string> = {
    Temperature: tempUnit(units),
    "Feels like": tempUnit(units),
    "Dew point": tempUnit(units),
    "Wet bulb": tempUnit(units),
    Enthalpy: " kJ/kg",
    Precipitation: ` ${PRECIP_UNIT}`,
    "Chance of precip": "%",
    "Cloud cover": "%",
    Humidity: "%",
    Pressure: " hPa",
  };

  const tooltip: EChartsOption["tooltip"] = {
    trigger: "axis",
    backgroundColor: palette.tooltipBg,
    borderWidth: 0,
    textStyle: { color: palette.tooltipText, fontSize: 12 },
    axisPointer: { type: "line", link: [{ xAxisIndex: "all" }], lineStyle: { color: palette.axisLabel } },
    formatter: (params: unknown) => {
      const arr = params as { seriesName: string; value: number; color: string; axisValue: string }[];
      if (!arr.length) return "";
      const hovered = input.getHovered?.();
      const rows = arr
        .filter((p) => !p.seriesName.startsWith("_") && p.value != null && Number.isFinite(p.value))
        .map((p) => {
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`;
          const suffix = unitFor[p.seriesName] ?? "";
          const on = p.seriesName === hovered;
          const row = `<span>${dot}${p.seriesName}</span><b>${p.value}${suffix}</b>`;
          const style =
            "display:flex;justify-content:space-between;gap:16px;border-radius:4px;padding:1px 4px;margin:0 -4px" +
            (on ? `;background:${palette.axisLabel}22;font-weight:700` : "");
          return `<div style="${style}">${row}</div>`;
        })
        .join("");
      return `<div style="font-weight:600;margin-bottom:4px">${tooltipHeader(arr[0].axisValue)}</div>${rows}`;
    },
  };

  return {
    animation: false,
    grid: grids,
    xAxis,
    yAxis: yAxes,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip,
    series: seriesList,
  };
}

function tooltipHeader(iso: string): string {
  return `${formatDayShort(iso)} · ${formatTime(iso)}`;
}

export interface LegendEntry {
  name: string;
  color: string;
}

/**
 * The visible series as {name, color} — names match the chart series exactly so
 * the HTML legend can drive ECharts highlight/downplay and reflect line hovers.
 */
export function meteogramLegend(input: {
  series: SeriesKey[];
  panels: PanelKey[];
  palette: ChartPalette;
}): LegendEntry[] {
  const { series, panels, palette } = input;
  const s: Record<SeriesKey, LegendEntry> = {
    temp: { name: "Temperature", color: palette.temp },
    feels: { name: "Feels like", color: palette.feels },
    dew: { name: "Dew point", color: palette.dew },
    wetbulb: { name: "Wet bulb", color: palette.wetbulb },
    enthalpy: { name: "Enthalpy", color: palette.enthalpy },
  };
  const out: LegendEntry[] = [];
  (["temp", "feels", "dew", "wetbulb", "enthalpy"] as SeriesKey[]).forEach(
    (k) => series.includes(k) && out.push(s[k]),
  );
  if (panels.includes("precip")) {
    out.push({ name: "Precipitation", color: palette.precip });
    out.push({ name: "Chance of precip", color: palette.precipProb });
  }
  if (panels.includes("atmo")) {
    out.push({ name: "Cloud cover", color: palette.cloud });
    out.push({ name: "Humidity", color: palette.humidity });
    out.push({ name: "Pressure", color: palette.pressure });
  }
  return out;
}
