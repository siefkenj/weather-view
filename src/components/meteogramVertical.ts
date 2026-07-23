// Transposed meteogram for small portrait screens: time runs DOWN the left
// (category y-axis, inverse), values run horizontally, and the panels become
// side-by-side columns instead of stacked rows. The whole chart is tall so the
// page scrolls vertically through time rather than the chart scrolling sideways.

import type { EChartsOption, SeriesOption } from "echarts";
import type { MeteogramInput } from "./meteogramOption";
import { cToDisplay, PRECIP_UNIT, tempUnit } from "../utils/units";
import { moistAirEnthalpy, wetBulbTemperature } from "../utils/psychro";
import { formatDayShort, formatTime } from "../utils/format";
import { dayShadeMarkArea } from "./meteogramShading";

const round1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN);

export function buildVerticalMeteogramOption(input: MeteogramInput): EChartsOption {
  const { hourly, palette, units, series, panels, tempBand, precipBand, nowIso } = input;
  const time = hourly.time;
  const pair = (vals: number[]): [number, string][] => vals.map((v, i) => [v, time[i]]);

  const showPrecip = panels.includes("precip");
  const showAtmo = panels.includes("atmo");
  const cols: ("temp" | "precip" | "atmo")[] = ["temp"];
  if (showPrecip) cols.push("precip");
  if (showAtmo) cols.push("atmo");
  const colIndex = Object.fromEntries(cols.map((c, i) => [c, i])) as Record<string, number>;

  const gutter = 13;
  const rightPad = 3;
  const gapCol = 3;
  const colW = (100 - gutter - rightPad) / cols.length;

  const grids: EChartsOption["grid"] = cols.map((_, c) => ({
    left: `${gutter + c * colW}%`,
    width: `${colW - gapCol}%`,
    top: 30,
    bottom: 14,
  }));

  const yAxis: EChartsOption["yAxis"] = cols.map((_, c) => ({
    type: "category",
    data: time,
    inverse: true,
    gridIndex: c,
    axisLine: { lineStyle: { color: palette.axisLine } },
    axisTick: { show: false },
    axisLabel:
      c === 0
        ? {
            color: palette.axisLabel,
            interval: (_idx: number, value: string) => value.slice(11, 13) === "00",
            formatter: (value: string) => formatDayShort(value),
            fontSize: 10,
          }
        : { show: false },
  }));

  const xAxes: EChartsOption["xAxis"] = [];
  const xIdx: Record<string, number> = {};
  const pushX = (key: string, def: object) => {
    xIdx[key] = (xAxes as object[]).length;
    (xAxes as object[]).push(def);
  };
  const xBase = (gi: number) => ({
    type: "value" as const,
    gridIndex: gi,
    position: "top" as const,
    splitLine: { lineStyle: { color: palette.splitLine } },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: palette.axisLabel, fontSize: 10, showMinLabel: false },
    nameTextStyle: { color: palette.axisLabel, fontSize: 10 },
    nameGap: 6,
  });

  pushX("temp", { ...xBase(colIndex.temp), scale: true, name: tempUnit(units), splitNumber: 3 });
  // Enthalpy shares the temp column but has its own value axis (kJ/kg). Hidden to
  // keep the narrow portrait layout readable; the tooltip carries its units.
  if (series.includes("enthalpy")) {
    pushX("enthalpy", { type: "value", gridIndex: colIndex.temp, scale: true, show: false });
  }
  if (showPrecip) {
    pushX("precip", { ...xBase(colIndex.precip), min: 0, name: PRECIP_UNIT, splitNumber: 2 });
    pushX("prob", { type: "value", gridIndex: colIndex.precip, min: 0, max: 100, show: false });
  }
  if (showAtmo) {
    pushX("pct", { ...xBase(colIndex.atmo), min: 0, max: 100, name: "%", splitNumber: 2 });
    pushX("pressure", { type: "value", gridIndex: colIndex.atmo, scale: true, show: false });
  }

  const seriesList: SeriesOption[] = [];
  const shade = dayShadeMarkArea(time, palette, "yAxis");
  const firstOfCol = new Set<number>();

  // Temperature confidence band (stacked along the value/x axis).
  if (tempBand && series.includes("temp")) {
    const lo = tempBand.lower.map((v) => round1(cToDisplay(v, units)));
    const width = tempBand.upper.map((v, i) => round1(cToDisplay(v, units) - cToDisplay(tempBand.lower[i], units)));
    seriesList.push({ name: "_tempLo", type: "line", data: pair(lo), xAxisIndex: xIdx.temp, yAxisIndex: colIndex.temp, stack: "tband", lineStyle: { opacity: 0 }, showSymbol: false, silent: true });
    seriesList.push({ name: "_tempBand", type: "line", data: pair(width), xAxisIndex: xIdx.temp, yAxisIndex: colIndex.temp, stack: "tband", lineStyle: { opacity: 0 }, areaStyle: { color: palette.bandTemp }, showSymbol: false, silent: true });
  }

  const nowMark = nowIso
    ? {
        symbol: "none",
        silent: true,
        lineStyle: { color: palette.nowLine, type: "dashed" as const, width: 1.5 },
        label: { show: true, formatter: "now", color: palette.nowLine, position: "end" as const },
        data: [{ yAxis: nowIso.slice(0, 13) + ":00" }],
      }
    : undefined;

  const nowHv = input.currentIso ? input.currentIso.slice(0, 13) : null;
  const thinWv = (w: number) => Math.max(0.6, w * 0.5);

  // Push a line split into a thin "past" and a thick "forecast" segment.
  const pushLineV = (
    name: string,
    vals: number[],
    color: string,
    gi: number,
    xi: number,
    baseWidth: number,
    extra: Partial<SeriesOption> = {},
  ) => {
    const { lineStyle: exLine, ...rest } = extra as Partial<SeriesOption> & {
      lineStyle?: Record<string, unknown>;
    };
    const attach = !firstOfCol.has(gi);
    firstOfCol.add(gi);
    const mk = (v: number[], width: number, shadeIt: boolean): SeriesOption =>
      ({
        name,
        type: "line",
        data: pair(v),
        xAxisIndex: xi,
        yAxisIndex: gi,
        showSymbol: false,
        smooth: 0.2,
        connectNulls: false,
        lineStyle: { ...(exLine ?? {}), color, width },
        itemStyle: { color },
        ...(shadeIt ? { markArea: shade } : {}),
        ...rest,
      }) as SeriesOption;
    const past = nowHv ? vals.map((v, i) => (time[i].slice(0, 13) <= nowHv ? v : NaN)) : vals;
    seriesList.push(mk(past, thinWv(baseWidth), attach));
    if (nowHv) {
      const fut = vals.map((v, i) => (time[i].slice(0, 13) >= nowHv ? v : NaN));
      seriesList.push(mk(fut, baseWidth, false));
    }
  };

  if (series.includes("temp")) {
    pushLineV("Temperature", hourly.temperature.map((v) => round1(cToDisplay(v, units))), palette.temp, colIndex.temp, xIdx.temp, 2, {
      z: 5,
      ...(nowMark ? { markLine: nowMark } : {}),
    });
  }
  if (series.includes("feels")) {
    const feelsData = hourly.apparent.map((v, i) =>
      Math.abs(hourly.apparent[i] - hourly.temperature[i]) > 2 ? round1(cToDisplay(v, units)) : NaN,
    );
    pushLineV("Feels like", feelsData, palette.feels, colIndex.temp, xIdx.temp, 1.6, { lineStyle: { type: "dashed" } });
  }
  if (series.includes("dew")) {
    pushLineV("Dew point", hourly.dewPoint.map((v) => round1(cToDisplay(v, units))), palette.dew, colIndex.temp, xIdx.temp, 1.6);
  }
  if (series.includes("wetbulb")) {
    const wb = hourly.temperature.map((t, i) => round1(cToDisplay(wetBulbTemperature(t, hourly.humidity[i], hourly.pressure[i]), units)));
    pushLineV("Wet bulb", wb, palette.wetbulb, colIndex.temp, xIdx.temp, 1.6);
  }
  if (series.includes("enthalpy")) {
    const en = hourly.temperature.map((t, i) => round1(moistAirEnthalpy(t, hourly.humidity[i], hourly.pressure[i])));
    pushLineV("Enthalpy", en, palette.enthalpy, colIndex.temp, xIdx.enthalpy, 1.6);
  }

  if (showPrecip) {
    if (precipBand) {
      const lo = precipBand.lower.map((v) => round1(Math.max(0, v)));
      const width = precipBand.upper.map((v, i) => round1(Math.max(0, v) - Math.max(0, precipBand.lower[i])));
      seriesList.push({ name: "_precipLo", type: "line", data: pair(lo), xAxisIndex: xIdx.precip, yAxisIndex: colIndex.precip, stack: "pband", lineStyle: { opacity: 0 }, showSymbol: false, silent: true });
      seriesList.push({ name: "_precipBand", type: "line", data: pair(width), xAxisIndex: xIdx.precip, yAxisIndex: colIndex.precip, stack: "pband", lineStyle: { opacity: 0 }, areaStyle: { color: palette.bandPrecip }, showSymbol: false, silent: true });
    }
    firstOfCol.add(colIndex.precip);
    seriesList.push({ name: "Precipitation", type: "bar", data: pair(hourly.precipitation.map(round1)), xAxisIndex: xIdx.precip, yAxisIndex: colIndex.precip, itemStyle: { color: palette.precip }, barMaxWidth: 5, z: 3 });
    const cur = input.currentIso ?? null;
    const probData = hourly.precipProbability.map((v, i) => (cur && time[i] < cur ? NaN : v));
    pushLineV("Chance of precip", probData, palette.precipProb, colIndex.precip, xIdx.prob, 1.4);
  }

  if (showAtmo) {
    firstOfCol.add(colIndex.atmo);
    seriesList.push({ name: "Cloud cover", type: "line", data: pair(hourly.cloudCover), xAxisIndex: xIdx.pct, yAxisIndex: colIndex.atmo, showSymbol: false, smooth: 0.2, lineStyle: { width: 0, color: palette.cloud }, areaStyle: { color: palette.cloud }, z: 1 });
    pushLineV("Humidity", hourly.humidity, palette.humidity, colIndex.atmo, xIdx.pct, 1.6);
    pushLineV("Pressure", hourly.pressure.map(round1), palette.pressure, colIndex.atmo, xIdx.pressure, 1.6);
  }

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
    axisPointer: { type: "line", link: [{ yAxisIndex: "all" }], lineStyle: { color: palette.axisLabel } },
    formatter: (params: unknown) => {
      const arr = params as { seriesName: string; value: unknown; color: string; axisValue: string }[];
      if (!arr.length) return "";
      const seen = new Set<string>();
      const rows = arr
        .filter((p) => !p.seriesName.startsWith("_"))
        .map((p) => {
          const scalar = Array.isArray(p.value) ? (p.value[0] as number) : (p.value as number);
          if (scalar == null || !Number.isFinite(scalar) || seen.has(p.seriesName)) return "";
          seen.add(p.seriesName);
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>`;
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot}${p.seriesName}</span><b>${scalar}${unitFor[p.seriesName] ?? ""}</b></div>`;
        })
        .join("");
      return `<div style="font-weight:600;margin-bottom:4px">${formatDayShort(arr[0].axisValue)} · ${formatTime(arr[0].axisValue)}</div>${rows}`;
    },
  };

  return {
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis,
    axisPointer: { link: [{ yAxisIndex: "all" }] },
    tooltip,
    series: seriesList,
  };
}
