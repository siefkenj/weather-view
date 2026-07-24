import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildMeteogramOption } from "./meteogramOption";
import { ForecastHeader } from "./ForecastHeader";
import { computeHorizontalLayout, tempTopEmptyFraction } from "./meteogramLayout";
import { useECharts } from "../hooks/useECharts";
import { useTheme } from "../hooks/useTheme";
import { chartPalette } from "../theme/palette";
import type { Bands } from "../api/ensemble";
import type { PanelKey, SeriesKey } from "../hooks/useUrlState";
import type { Units } from "../utils/units";
import type { DailySummary, HourlyPoint } from "../utils/series";

interface Props {
  hourly: HourlyPoint;
  units: Units;
  series: SeriesKey[];
  panels: PanelKey[];
  tempBand?: Bands | null;
  precipBand?: Bands | null;
  nowIso?: string | null;
  /** The real current time (always) — hides chance-of-precip for past hours. */
  currentIso?: string | null;
  height?: number;
  /** When provided, day/date + icon are drawn on the graph, in the headroom at the
   *  top of the temperature panel. */
  daily?: DailySummary[];
  todayKey?: string;
  /** Series names hidden via the legend. */
  hidden?: string[];
  /** AQHI per hour (aligned to hourly.time) for the integrated air-quality panel. */
  aqhi?: (number | null)[];
}

const HOVER_BOOST = 1.8;

export function Meteogram({
  hourly,
  units,
  series,
  panels,
  tempBand,
  precipBand,
  nowIso,
  currentIso,
  height = 520,
  daily,
  todayKey,
  hidden,
  aqhi,
}: Props) {
  const { theme } = useTheme();
  const integrated = !!daily && daily.length > 0;
  const palette = chartPalette(theme);
  // Drop the air panel when there's no AQHI data for this window.
  const effPanels = aqhi ? panels : panels.filter((p) => p !== "air");
  // Which line the cursor is on. A ref (not state) so hovering never re-renders
  // React; the tooltip formatter reads it live to bold the matching row.
  const hoveredRef = useRef<string | null>(null);
  const getHovered = useCallback(() => hoveredRef.current, []);

  const option = useMemo(() => {
    return buildMeteogramOption({
      hourly,
      palette,
      units,
      series,
      panels: effPanels,
      tempBand,
      precipBand,
      nowIso,
      currentIso,
      headroom: integrated,
      getHovered,
      hidden,
      aqhi,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourly, units, series.join(","), effPanels.join(","), tempBand, precipBand, nowIso, currentIso, theme, integrated, (hidden ?? []).join(","), aqhi]);

  const { containerRef: ref, chartRef } = useECharts(option);

  // Each series' own base line width, keyed by index — so split past/future
  // lines (thin vs thick) each revert to their own width after a hover.
  const baseWidths = useMemo(
    () => ((option.series as { lineStyle?: { width?: number } }[]) ?? []).map((s) => s?.lineStyle?.width),
    [option],
  );
  const baseWidthsRef = useRef(baseWidths);
  baseWidthsRef.current = baseWidths;

  // Bold only the hovered line by merging its lineStyle width — ECharts' own
  // emphasis is disabled (the axis tooltip would otherwise bold every series).
  const applyHover = useCallback((name: string | null) => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = (chart.getOption().series ?? []) as { type?: string; name?: string }[];
    const bw = baseWidthsRef.current;
    const patch = current.map((s, i) => {
      const base = bw[i];
      if (s.type !== "line" || base == null) return {};
      return { lineStyle: { width: name && s.name === name ? base + HOVER_BOOST : base } };
    });
    chart.setOption({ series: patch });
  }, [chartRef]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onOver = (p: { componentType?: string; seriesType?: string; seriesName?: string }) => {
      if (p.componentType === "series" && p.seriesType === "line" && p.seriesName && !p.seriesName.startsWith("_")) {
        if (hoveredRef.current === p.seriesName) return;
        hoveredRef.current = p.seriesName;
        applyHover(p.seriesName);
      }
    };
    const onOut = () => {
      if (hoveredRef.current == null) return;
      hoveredRef.current = null;
      applyHover(null);
    };
    chart.on("mouseover", onOver);
    chart.on("mouseout", onOut);
    chart.on("globalout", onOut); // leaving the chart entirely fires globalout, not mouseout
    return () => {
      chart.off("mouseover", onOver);
      chart.off("mouseout", onOut);
      chart.off("globalout", onOut);
    };
  }, [chartRef, applyHover]);

  const resolvedHeight = integrated ? 560 : height;

  // Where the on-graph tiles sit: the empty band at the top of the temp panel.
  const band = useMemo(() => {
    if (!integrated) return null;
    const temp = computeHorizontalLayout(effPanels).grids[0];
    return { top: temp.top, height: temp.height * tempTopEmptyFraction() };
  }, [integrated, effPanels]);

  return (
    <div className="meteogram-graph" style={{ position: "relative" }}>
      <div
        ref={ref}
        className="meteogram"
        style={{ height: resolvedHeight }}
        aria-label="Weather meteogram"
      />
      {integrated && band && daily ? (
        <div className="graph-dates" style={{ top: `${band.top}%`, height: `${band.height}%` }}>
          <ForecastHeader
            summaries={daily}
            units={units}
            todayKey={todayKey}
            windowStart={hourly.time[0]}
            windowEnd={hourly.time[hourly.time.length - 1]}
          />
        </div>
      ) : null}
    </div>
  );
}
