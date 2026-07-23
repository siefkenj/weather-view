import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useECharts } from "../hooks/useECharts";
import { useTheme } from "../hooks/useTheme";
import { chartPalette, type ChartPalette } from "../theme/palette";
import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { dayKey, formatDayShort, formatFullDate, formatTime } from "../utils/format";
import { findNowIndex } from "../utils/series";
import type { AirQualityResponse } from "../api/types";

interface Props {
  data: AirQualityResponse;
  /** AQHI per hour, aligned to data.hourly.time. */
  aqhi: number[];
  /** Visible window (matches the meteogram) so the graph shows the same days. */
  startKey: string;
  endKey: string;
  /** Focused hour — the tiles/badge describe this moment. */
  nowIso: string;
}

const BAND = {
  low: aqhiCategory(2).color,
  moderate: aqhiCategory(5).color,
  high: aqhiCategory(8).color,
  veryHigh: aqhiCategory(11).color,
};

function buildAqhiOption(
  time: string[],
  aqhi: number[],
  nowLabel: string | null,
  palette: ChartPalette,
): EChartsOption {
  const finite = aqhi.filter((v) => Number.isFinite(v));
  const yMax = Math.min(11, Math.max(4, Math.ceil(Math.max(1, ...finite)) + 1));
  return {
    animation: false,
    grid: { left: 30, right: 12, top: 12, bottom: 22 },
    xAxis: {
      type: "category",
      data: time,
      boundaryGap: false,
      axisLine: { lineStyle: { color: palette.axisLine } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.axisLabel,
        interval: (_i: number, v: string) => v.slice(11, 13) === "12",
        formatter: (v: string) => formatDayShort(v),
        hideOverlap: true,
      },
      axisPointer: { label: { formatter: (p: { value: unknown }) => `${formatDayShort(String(p.value))} ${formatTime(String(p.value))}` } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: yMax,
      interval: Math.max(1, Math.round(yMax / 4)),
      splitLine: { lineStyle: { color: palette.splitLine } },
      axisLabel: { color: palette.axisLabel },
    },
    visualMap: {
      show: false,
      type: "piecewise",
      dimension: 1,
      seriesIndex: 0,
      pieces: [
        { lte: 3, color: BAND.low },
        { gt: 3, lte: 6, color: BAND.moderate },
        { gt: 6, lte: 10, color: BAND.high },
        { gt: 10, color: BAND.veryHigh },
      ],
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.tooltipBg,
      borderWidth: 0,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = params as { value: number; axisValue: string }[];
        const p = arr?.[0];
        if (!p) return "";
        const v = p.value == null || !Number.isFinite(p.value) ? "–" : p.value;
        return `<div style="font-weight:600">${formatDayShort(p.axisValue)} · ${formatTime(p.axisValue)}</div>AQHI <b>${v}</b>`;
      },
    },
    series: [
      {
        name: "AQHI",
        type: "line",
        data: aqhi,
        showSymbol: false,
        smooth: 0.2,
        connectNulls: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.16 },
        ...(nowLabel
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                lineStyle: { color: palette.nowLine, type: "dashed" as const, width: 1.5 },
                label: { show: true, formatter: "now", color: palette.nowLine, position: "start" as const },
                data: [{ xAxis: nowLabel }],
              },
            }
          : {}),
      },
    ],
  };
}

export function AirQualityPanel({ data, aqhi, startKey, endKey, nowIso }: Props) {
  const { theme } = useTheme();
  const palette = chartPalette(theme);
  const h = data.hourly;
  const units = data.hourly_units;

  const fi = Math.max(0, findNowIndex(h.time, nowIso));
  const focusIso = h.time[fi] ?? nowIso;
  const focusAqhi = aqhi[fi];
  const cat = aqhiCategory(focusAqhi);

  const window = useMemo(() => {
    const time: string[] = [];
    const vals: number[] = [];
    for (let i = 0; i < h.time.length; i++) {
      const k = dayKey(h.time[i]);
      if (k >= startKey && k <= endKey) {
        time.push(h.time[i]);
        vals.push(aqhi[i]);
      }
    }
    return { time, vals };
  }, [h.time, aqhi, startKey, endKey]);

  const hasGraph = window.vals.some((v) => Number.isFinite(v));
  const nowLabel = window.time.includes(nowIso.slice(0, 13) + ":00") ? nowIso.slice(0, 13) + ":00" : null;

  const option = useMemo(
    () => (hasGraph ? buildAqhiOption(window.time, window.vals, nowLabel, palette) : null),
    [hasGraph, window, nowLabel, palette],
  );
  const { containerRef } = useECharts(option);

  const tiles = [
    { key: "PM2.5", value: h.pm2_5?.[fi], unit: units.pm2_5 },
    { key: "PM10", value: h.pm10?.[fi], unit: units.pm10 },
    { key: "Ozone", value: h.ozone?.[fi], unit: units.ozone },
    { key: "NO₂", value: h.nitrogen_dioxide?.[fi], unit: units.nitrogen_dioxide },
  ];

  return (
    <section className="panel air-quality" aria-label="Air quality">
      <header className="panel__head">
        <div className="aqi-title">
          <h2>Air quality</h2>
          <span className="aqi-sub" title={formatFullDate(focusIso)}>
            {formatDayShort(focusIso)} · {formatTime(focusIso)}
          </span>
        </div>
        <div className="aqi-badge">
          <span className="aqi-number">
            {formatAqhi(focusAqhi)}
            <span className="aqi-unit">AQHI</span>
          </span>
          <span className="aqi-chip" style={{ background: cat.color }}>
            {cat.label}
          </span>
        </div>
      </header>

      <div className="aqi-graph">
        <div ref={containerRef} className="aqi-chart" aria-label="Air Quality Health Index over the visible days" />
        {!hasGraph ? <p className="aqi-empty">No air-quality data for this range.</p> : null}
      </div>

      <div className="aqi-tiles">
        {tiles.map((t) => (
          <div className="aqi-tile" key={t.key}>
            <span className="aqi-tile__key">{t.key}</span>
            <span className="aqi-tile__val">
              {Number.isFinite(t.value) ? Math.round(t.value) : "–"}
              <span className="aqi-tile__unit"> {t.unit ?? "µg/m³"}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
