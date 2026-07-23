import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildMeteogramOption } from "./meteogramOption";
import { buildVerticalMeteogramOption } from "./meteogramVertical";
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
  height?: number;
  /** Transposed (time runs top-to-bottom) for small portrait screens. */
  vertical?: boolean;
  /** When provided (horizontal only), day/date + icon are drawn on the graph,
   *  in the headroom at the top of the temperature panel. */
  daily?: DailySummary[];
  todayKey?: string;
}

// Base line widths per series (must match buildMeteogramOption). Hovering a line
// bumps only that one by HOVER_BOOST; everything else stays at its base width.
const BASE_WIDTH: Record<string, number> = {
  Temperature: 2,
  "Feels like": 1.6,
  "Dew point": 1.6,
  "Wet bulb": 1.6,
  Enthalpy: 1.6,
  "Chance of precip": 1.6,
  "Cloud cover": 0,
  Humidity: 1.8,
  Pressure: 1.8,
};
const HOVER_BOOST = 1.8;

export function Meteogram({
  hourly,
  units,
  series,
  panels,
  tempBand,
  precipBand,
  nowIso,
  height = 520,
  vertical = false,
  daily,
  todayKey,
}: Props) {
  const { theme } = useTheme();
  const integrated = !vertical && !!daily && daily.length > 0;
  const palette = chartPalette(theme);
  // Which line the cursor is on. A ref (not state) so hovering never re-renders
  // React; the tooltip formatter reads it live to bold the matching row.
  const hoveredRef = useRef<string | null>(null);
  const getHovered = useCallback(() => hoveredRef.current, []);

  const option = useMemo(() => {
    const build = vertical ? buildVerticalMeteogramOption : buildMeteogramOption;
    return build({
      hourly,
      palette,
      units,
      series,
      panels,
      tempBand,
      precipBand,
      nowIso,
      headroom: integrated,
      getHovered,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourly, units, series.join(","), panels.join(","), tempBand, precipBand, nowIso, theme, vertical, integrated]);

  const { containerRef: ref, chartRef } = useECharts(option);

  // Bold only the hovered line by merging its lineStyle width — ECharts' own
  // emphasis is disabled (the axis tooltip would otherwise bold every series).
  const applyHover = useCallback((name: string | null) => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = (chart.getOption().series ?? []) as { type?: string; name?: string }[];
    const patch = current.map((s) => {
      const base = s.name ? BASE_WIDTH[s.name] : undefined;
      if (s.type !== "line" || base == null) return {};
      return { lineStyle: { width: name === s.name ? base + HOVER_BOOST : base } };
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

  const resolvedHeight = vertical
    ? Math.min(Math.max(hourly.time.length * 3.4, 460), 1500)
    : integrated
      ? 560
      : height;

  // Where the on-graph tiles sit: the empty band at the top of the temp panel.
  const band = useMemo(() => {
    if (!integrated) return null;
    const temp = computeHorizontalLayout(panels).grids[0];
    return { top: temp.top, height: temp.height * tempTopEmptyFraction() };
  }, [integrated, panels]);

  return (
    <div className="meteogram-graph" style={{ position: "relative" }}>
      <div
        ref={ref}
        className={"meteogram" + (vertical ? " meteogram--vertical" : "")}
        style={{ height: resolvedHeight }}
        aria-label="Weather meteogram"
      />
      {integrated && band && daily ? (
        <div className="graph-dates" style={{ top: `${band.top}%`, height: `${band.height}%` }}>
          <ForecastHeader summaries={daily} units={units} todayKey={todayKey} />
        </div>
      ) : null}
    </div>
  );
}
