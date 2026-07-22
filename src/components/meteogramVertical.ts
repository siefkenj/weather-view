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
  const withShade = (gi: number) => {
    const attach = !firstOfCol.has(gi);
    firstOfCol.add(gi);
    return attach ? { markArea: shade } : {};
  };

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

  const lineV = (
    name: string,
    vals: number[],
    color: string,
    gi: number,
    xi: number,
    extra: Partial<SeriesOption> = {},
  ): SeriesOption =>
    ({
      name,
      type: "line",
      data: pair(vals),
      xAxisIndex: xi,
      yAxisIndex: gi,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      ...withShade(gi),
      ...extra,
    }) as SeriesOption;

  if (series.includes("temp")) {
    seriesList.push(
      lineV("Temperature", hourly.temperature.map((v) => round1(cToDisplay(v, units))), palette.temp, colIndex.temp, xIdx.temp, {
        z: 5,
        ...(nowMark ? { markLine: nowMark } : {}),
      }),
    );
  }
  if (series.includes("feels")) {
    seriesList.push(lineV("Feels like", hourly.apparent.map((v) => round1(cToDisplay(v, units))), palette.feels, colIndex.temp, xIdx.temp, { lineStyle: { color: palette.feels, width: 1.6 } }));
  }
  if (series.includes("dew")) {
    seriesList.push(lineV("Dew point", hourly.dewPoint.map((v) => round1(cToDisplay(v, units))), palette.dew, colIndex.temp, xIdx.temp, { lineStyle: { color: palette.dew, width: 1.6 } }));
  }
  if (series.includes("wetbulb")) {
    const wb = hourly.temperature.map((t, i) => round1(cToDisplay(wetBulbTemperature(t, hourly.humidity[i], hourly.pressure[i]), units)));
    seriesList.push(lineV("Wet bulb", wb, palette.wetbulb, colIndex.temp, xIdx.temp, { lineStyle: { color: palette.wetbulb, width: 1.6 } }));
  }
  if (series.includes("enthalpy")) {
    const en = hourly.temperature.map((t, i) => round1(moistAirEnthalpy(t, hourly.humidity[i], hourly.pressure[i])));
    seriesList.push(lineV("Enthalpy", en, palette.enthalpy, colIndex.temp, xIdx.enthalpy, { lineStyle: { color: palette.enthalpy, width: 1.6 } }));
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
    seriesList.push({ name: "Chance of precip", type: "line", data: pair(hourly.precipProbability), xAxisIndex: xIdx.prob, yAxisIndex: colIndex.precip, showSymbol: false, smooth: 0.2, lineStyle: { color: palette.precipProb, width: 1.4 }, itemStyle: { color: palette.precipProb } });
  }

  if (showAtmo) {
    firstOfCol.add(colIndex.atmo);
    seriesList.push({ name: "Cloud cover", type: "line", data: pair(hourly.cloudCover), xAxisIndex: xIdx.pct, yAxisIndex: colIndex.atmo, showSymbol: false, smooth: 0.2, lineStyle: { width: 0, color: palette.cloud }, areaStyle: { color: palette.cloud }, z: 1 });
    seriesList.push({ name: "Humidity", type: "line", data: pair(hourly.humidity), xAxisIndex: xIdx.pct, yAxisIndex: colIndex.atmo, showSymbol: false, smooth: 0.2, lineStyle: { color: palette.humidity, width: 1.6 }, itemStyle: { color: palette.humidity } });
    seriesList.push({ name: "Pressure", type: "line", data: pair(hourly.pressure.map(round1)), xAxisIndex: xIdx.pressure, yAxisIndex: colIndex.atmo, showSymbol: false, smooth: 0.2, lineStyle: { color: palette.pressure, width: 1.6 }, itemStyle: { color: palette.pressure } });
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
      const rows = arr
        .filter((p) => !p.seriesName.startsWith("_"))
        .map((p) => {
          const scalar = Array.isArray(p.value) ? (p.value[0] as number) : (p.value as number);
          if (scalar == null || !Number.isFinite(scalar)) return "";
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
