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
import { aqhiCategory } from "../utils/aqhi";
import type { HourlyPoint } from "../utils/series";

// AQHI risk-band colours for the integrated air-quality panel.
const AQHI_BANDS = {
  low: aqhiCategory(2).color,
  moderate: aqhiCategory(5).color,
  high: aqhiCategory(8).color,
  veryHigh: aqhiCategory(11).color,
};

export interface MeteogramInput {
  hourly: HourlyPoint;
  palette: ChartPalette;
  units: Units;
  series: SeriesKey[];
  panels: PanelKey[];
  tempBand?: Bands | null;
  precipBand?: Bands | null;
  nowIso?: string | null;
  /** The real current time (always), used to hide chance-of-precip for past hours. */
  currentIso?: string | null;
  /** Add empty space at the top of the temp panel for the on-graph day tiles. */
  headroom?: boolean;
  /** Live accessor for the currently hovered series name (bolded in the tooltip). */
  getHovered?: () => string | null;
  /** Series names hidden via the legend (their lines are not drawn). */
  hidden?: string[];
  /** AQHI per hour, aligned to hourly.time, for the integrated air-quality panel. */
  aqhi?: (number | null)[];
}

const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN);

export function buildMeteogramOption(input: MeteogramInput): EChartsOption {
  const { hourly, palette, units, series, panels, tempBand, precipBand, nowIso } = input;
  const time = hourly.time;
  const hiddenSet = new Set(input.hidden ?? []);
  const isHidden = (name: string) => hiddenSet.has(name);

  // Split point between "past" and "forecast": the last grid index at or before
  // the real current time. Index-based so it works at any resolution (hourly or
  // the refined 15-minute grid); -1 when there's no current time in range.
  const cur = input.currentIso ? input.currentIso.slice(0, 16) : null;
  let nowIdx = -1;
  if (cur) for (let i = 0; i < time.length; i++) if (time[i].slice(0, 16) <= cur) nowIdx = i;

  const showPrecip = panels.includes("precip");
  const showAtmo = panels.includes("atmo");
  const showAir = panels.includes("air") && Array.isArray(input.aqhi);

  // ---- Panel layout (percentages) --------------------------------------
  // The air panel is only laid out when it has data to draw.
  const layoutPanels = showAir ? panels : panels.filter((p) => p !== "air");
  const { panelKeys: panelList, grids: gridBoxes } = computeHorizontalLayout(layoutPanels);

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
    // Match the full HH:MM so the 15-min grid doesn't stack four labels at noon.
    interval: (_idx: number, value: string) => value.slice(11, 16) === "12:00",
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

  // A thick gridline + label every 5 °C (10 °F), and a thin gridline every 1 °C (2 °F).
  const gridStep = units === "imperial" ? 2 : 1;
  const labelStep = units === "imperial" ? 10 : 5;
  pushY("temp", {
    ...yBase(gridIndex.temp),
    name: input.headroom ? "" : tempUnit(units),
    nameTextStyle: { color: palette.axisLabel },
    scale: true,
    interval: labelStep,
    splitLine: { lineStyle: { color: palette.splitLine, width: 1.5 } },
    minorTick: { show: false, splitNumber: Math.round(labelStep / gridStep) },
    minorSplitLine: { show: true, lineStyle: { color: palette.splitLine, width: 0.5 } },
    ...(input.headroom
      ? {
          // Snap the padded range to whole label steps so labels stay clean.
          min: (v: { min: number; max: number }) =>
            Math.floor((v.min - (v.max - v.min) * TEMP_HEADROOM.bottom) / labelStep) * labelStep,
          max: (v: { min: number; max: number }) =>
            Math.ceil((v.max + (v.max - v.min) * TEMP_HEADROOM.top) / labelStep) * labelStep,
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
  const aqhiFinite = showAir ? (input.aqhi!.filter((v) => v != null && Number.isFinite(v)) as number[]) : [];
  const aqhiMax = Math.min(11, Math.max(4, Math.ceil(Math.max(1, ...aqhiFinite)) + 1));
  if (showAir) {
    pushY("aqhi", {
      ...yBase(gridIndex.air),
      name: "AQHI",
      min: 0,
      max: aqhiMax,
      interval: Math.max(1, Math.round(aqhiMax / 4)),
      nameTextStyle: { color: palette.axisLabel },
    });
  }

  // ---- Series ----------------------------------------------------------
  const seriesList: SeriesOption[] = [];
  const shade = dayShadeMarkArea(time, palette, "xAxis");
  const firstOfPanel = new Set<number>();
  // Emphasis off everywhere; hover bolding is manual.
  const lineEmph = { disabled: true as const };
  const thinW = (w: number) => Math.max(0.6, w * 0.5);

  // Push a line split into a thin "past" (already happened) segment and a thick
  // "forecast" segment; both share the series name and the split index (nowIdx),
  // so the two halves join. The first line in a panel carries the day-shading
  // markArea. Returns the pushed series indices.
  const pushLine = (
    name: string,
    data: number[],
    color: string,
    gi: number,
    yi: number,
    baseWidth: number,
    extra: Partial<SeriesOption> = {},
  ): number[] => {
    const { lineStyle: exLine, ...rest } = extra as Partial<SeriesOption> & {
      lineStyle?: Record<string, unknown>;
    };
    const withShade = !firstOfPanel.has(gi);
    firstOfPanel.add(gi);
    const mk = (d: number[], width: number, shadeIt: boolean): SeriesOption =>
      ({
        name,
        type: "line",
        data: d,
        xAxisIndex: gi,
        yAxisIndex: yi,
        showSymbol: false,
        smooth: 0.2,
        connectNulls: false,
        lineStyle: { ...(exLine ?? {}), color, width },
        itemStyle: { color },
        emphasis: { disabled: true },
        ...(shadeIt ? { markArea: shade } : {}),
        ...rest,
      }) as SeriesOption;
    const indices: number[] = [];
    const past = nowIdx >= 0 ? data.map((v, i) => (i <= nowIdx ? v : NaN)) : data;
    indices.push(seriesList.length);
    seriesList.push(mk(past, thinW(baseWidth), withShade));
    if (nowIdx >= 0) {
      const fut = data.map((v, i) => (i >= nowIdx ? v : NaN));
      indices.push(seriesList.length);
      seriesList.push(mk(fut, baseWidth, false));
    }
    return indices;
  };

  // Temperature confidence band (drawn under the lines).
  if (tempBand && series.includes("temp") && !isHidden("Temperature")) {
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

  // Snap the "now" marker to the nearest grid category so it lands correctly on
  // both the hourly and the refined 15-minute axes.
  const nowMark =
    nowIso && nowIdx >= 0
      ? {
          symbol: "none",
          silent: true,
          lineStyle: { color: palette.nowLine, type: "dashed" as const, width: 1.5 },
          label: { show: true, formatter: "now", color: palette.nowLine, position: "start" as const },
          data: [{ xAxis: time[nowIdx] }],
        }
      : undefined;

  if (series.includes("temp") && !isHidden("Temperature")) {
    pushLine("Temperature", hourly.temperature.map((v) => round1(cToDisplay(v, units))), palette.temp, gridIndex.temp, yIdx.temp, 2, {
      z: 5,
      ...(nowMark ? { markLine: nowMark } : {}),
    });
  }
  if (series.includes("feels") && !isHidden("Feels like")) {
    // Dashed, and only where it diverges from the temperature by > 2 °C.
    const feelsData = hourly.apparent.map((v, i) =>
      Math.abs(hourly.apparent[i] - hourly.temperature[i]) > 2 ? round1(cToDisplay(v, units)) : NaN,
    );
    pushLine("Feels like", feelsData, palette.feels, gridIndex.temp, yIdx.temp, 1.6, { lineStyle: { type: "dashed" } });
  }
  if (series.includes("dew") && !isHidden("Dew point")) {
    pushLine("Dew point", hourly.dewPoint.map((v) => round1(cToDisplay(v, units))), palette.dew, gridIndex.temp, yIdx.temp, 1.6);
  }
  if (series.includes("wetbulb") && !isHidden("Wet bulb")) {
    const wb = hourly.temperature.map((t, i) => round1(cToDisplay(wetBulbTemperature(t, hourly.humidity[i], hourly.pressure[i]), units)));
    pushLine("Wet bulb", wb, palette.wetbulb, gridIndex.temp, yIdx.temp, 1.6);
  }
  if (series.includes("enthalpy") && !isHidden("Enthalpy")) {
    const en = hourly.temperature.map((t, i) => round1(moistAirEnthalpy(t, hourly.humidity[i], hourly.pressure[i])));
    pushLine("Enthalpy", en, palette.enthalpy, gridIndex.temp, yIdx.enthalpy, 1.6);
  }

  // Precipitation panel.
  if (showPrecip) {
    if (precipBand && !isHidden("Precipitation")) {
      const lo = precipBand.lower.map((v) => round1(Math.max(0, v)));
      const width = precipBand.upper.map((v, i) => round1(Math.max(0, v) - Math.max(0, precipBand.lower[i])));
      seriesList.push({ name: "_precipLo", type: "line", data: lo, xAxisIndex: gridIndex.precip, yAxisIndex: yIdx.precip, stack: "pband", lineStyle: { opacity: 0 }, showSymbol: false, silent: true });
      seriesList.push({ name: "_precipBand", type: "line", data: width, xAxisIndex: gridIndex.precip, yAxisIndex: yIdx.precip, stack: "pband", lineStyle: { opacity: 0 }, areaStyle: { color: palette.bandPrecip }, showSymbol: false, silent: true });
    }
    firstOfPanel.add(gridIndex.precip); // shade already on temp; keep precip clean
    if (!isHidden("Precipitation")) {
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
    }
    if (!isHidden("Chance of precip")) {
      // A forecast probability is meaningless for hours that have already
      // happened — show it only from "now" forward (so it's all "forecast", thick).
      const cur = input.currentIso ?? null;
      const probData = hourly.precipProbability.map((v, i) => (cur && time[i] < cur ? NaN : v));
      pushLine("Chance of precip", probData, palette.precipProb, gridIndex.precip, yIdx.prob, 1.6, {
        areaStyle: { color: palette.bandPrecip, opacity: 0.35 },
      });
    }
  }

  // Atmosphere panel.
  if (showAtmo) {
    firstOfPanel.add(gridIndex.atmo);
    if (!isHidden("Cloud cover")) {
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
    }
    if (!isHidden("Humidity")) {
      pushLine("Humidity", hourly.humidity, palette.humidity, gridIndex.atmo, yIdx.pct, 1.8);
    }
    if (!isHidden("Pressure")) {
      pushLine("Pressure", hourly.pressure.map(round1), palette.pressure, gridIndex.atmo, yIdx.pressure, 1.8);
    }
  }

  // Air-quality panel: AQHI line coloured by risk band (via visualMap below).
  let aqhiSeriesIndices: number[] = [];
  if (showAir && !isHidden("Air quality")) {
    firstOfPanel.add(gridIndex.air);
    const aqhiData = (input.aqhi as (number | null)[]).map((v) => (v == null ? NaN : v));
    aqhiSeriesIndices = pushLine("Air quality", aqhiData, AQHI_BANDS.moderate, gridIndex.air, yIdx.aqhi, 2, {
      areaStyle: { opacity: 0.14 },
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
    "Air quality": " AQHI",
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
      // Past/forecast split means each series appears twice; keep one finite row.
      const seen = new Set<string>();
      const rows = arr
        .filter((p) => !p.seriesName.startsWith("_") && p.value != null && Number.isFinite(p.value))
        .filter((p) => (seen.has(p.seriesName) ? false : (seen.add(p.seriesName), true)))
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

  // Colour the AQHI line(s) by risk band (past + forecast segments).
  const visualMap =
    aqhiSeriesIndices.length > 0
      ? {
          show: false,
          type: "piecewise" as const,
          dimension: 1,
          seriesIndex: aqhiSeriesIndices,
          pieces: [
            { lte: 3, color: AQHI_BANDS.low },
            { gt: 3, lte: 6, color: AQHI_BANDS.moderate },
            { gt: 6, lte: 10, color: AQHI_BANDS.high },
            { gt: 10, color: AQHI_BANDS.veryHigh },
          ],
        }
      : undefined;

  return {
    animation: false,
    grid: grids,
    xAxis,
    yAxis: yAxes,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip,
    series: seriesList,
    ...(visualMap ? { visualMap } : {}),
  };
}

function tooltipHeader(iso: string): string {
  return `${formatDayShort(iso)} · ${formatTime(iso)}`;
}

export type LegendEntry = { name: string; color: string; help: string } & (
  | { kind: "series"; seriesKey: SeriesKey } // a togglable settings series
  | { kind: "line" } // a panel sub-line (toggled locally via the legend)
);

/**
 * Every chart line as {name, color, kind, help}. Names match the chart series
 * exactly. The five temperature series are always listed (so a deactivated one
 * shows as an empty box); panel sub-lines appear only when their panel is on. The
 * `help` text is shown on legend hover — it replaces the old settings-menu chips.
 */
export function meteogramLegend(input: {
  panels: PanelKey[];
  palette: ChartPalette;
  hasAir?: boolean;
}): LegendEntry[] {
  const { panels, palette } = input;
  const out: LegendEntry[] = [
    { name: "Temperature", color: palette.temp, kind: "series", seriesKey: "temp", help: "Air temperature measured 2 m above the ground." },
    { name: "Feels like", color: palette.feels, kind: "series", seriesKey: "feels", help: "Feels-like (apparent) temperature — folds in humidity, wind, and sun. Dashed, and shown only where it differs from the temperature by more than 2 °C." },
    { name: "Dew point", color: palette.dew, kind: "series", seriesKey: "dew", help: "Dew point — the temperature at which dew forms; higher feels muggier." },
    { name: "Wet bulb", color: palette.wetbulb, kind: "series", seriesKey: "wetbulb", help: "Wet-bulb temperature — the coolest a surface can get by evaporation. Sustained values near 35 °C are life-threatening even in the shade." },
    { name: "Enthalpy", color: palette.enthalpy, kind: "series", seriesKey: "enthalpy", help: "Enthalpy — total heat energy of the moist air (kJ/kg), combining temperature and humidity." },
  ];
  if (panels.includes("precip")) {
    out.push({ name: "Precipitation", color: palette.precip, kind: "line", help: "Hourly precipitation amount (rain / melted snow), in mm." });
    out.push({ name: "Chance of precip", color: palette.precipProb, kind: "line", help: "Probability of precipitation — a forecast, so it's hidden for hours that have already passed." });
  }
  if (panels.includes("atmo")) {
    out.push({ name: "Cloud cover", color: palette.cloud, kind: "line", help: "Fraction of the sky covered by cloud (%)." });
    out.push({ name: "Humidity", color: palette.humidity, kind: "line", help: "Relative humidity (%)." });
    out.push({ name: "Pressure", color: palette.pressure, kind: "line", help: "Surface air pressure (hPa)." });
  }
  if (panels.includes("air") && input.hasAir) {
    out.push({ name: "Air quality", color: AQHI_BANDS.moderate, kind: "line", help: "Canada's Air Quality Health Index (AQHI, 1–10+), coloured by health-risk band." });
  }
  return out;
}
