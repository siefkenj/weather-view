import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildMeteogramOption, tempPanelVisible, type TooltipPositionFn } from "./meteogramOption";
import { ForecastHeader } from "./ForecastHeader";
import {
  computeHorizontalLayout,
  tempTopEmptyFraction,
  TILE_BAND,
  LAYOUT_TOP_PAD,
  CHART_HEIGHT,
  CHART_HEIGHT_INTEGRATED,
} from "./meteogramLayout";
import { useECharts } from "../hooks/useECharts";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { chartPalette } from "../theme/palette";
import { useAppDispatch } from "../store";
import { closeHover, openHover } from "../store/readoutSlice";
import type { Bands } from "../api/ensemble";
import type { AirMode } from "../api/airQualityGrid";
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
  /** Air-quality value per hour (active index), aligned to hourly.time. */
  air?: (number | null)[];
  /** Which air index is shown (AQHI or AQI). */
  airIndex?: AirMode;
  /** Peak air-quality value per day (YYYY-MM-DD → value) for the day popups. */
  dailyAir?: Map<string, number>;
  /** Mobile scrubber position: the data index the inspector line sits at, or null when
   *  the scrubber hasn't been engaged (no line shown). Drives an imperative showTip. */
  scrubIndex?: number | null;
  /** Mobile: hide the stats popover (keep only the inspector line). Toggled by the
   *  details label above the scrubber. */
  popoverHidden?: boolean;
}

const HOVER_BOOST = 1.8;
// The day tiles are taller than the headroom band they sit in, so they overhang it
// slightly. The band captures the pointer to keep the chart's axis tooltip from
// showing in the icon row; extend that capture zone by this many px above and below
// so it fully contains the tiles (no canvas leaks through the gaps between them).
const DATE_BAND_PAD = 16;

export function Meteogram({
  hourly,
  units,
  series,
  panels,
  tempBand,
  precipBand,
  nowIso,
  currentIso,
  height = CHART_HEIGHT,
  daily,
  todayKey,
  hidden,
  air,
  airIndex,
  dailyAir,
  scrubIndex,
  popoverHidden,
}: Props) {
  const { theme } = useTheme();
  const dispatch = useAppDispatch();
  const integrated = !!daily && daily.length > 0;
  const palette = chartPalette(theme);
  // Mobile: strip units from the %/pressure axis labels to save horizontal space. Also
  // the "mobile mode" flag: the graph is pan/pinch-only and the scrubber drives the line.
  const compact = useMediaQuery("(max-width: 640px)");
  // The caller (chartPanels) already decides whether the air panel is on — keep it
  // even without data, so the axis still shows (an empty air panel).
  const effPanels = panels;
  // Which line the cursor is on. A ref (not state) so hovering never re-renders
  // React; the tooltip formatter reads it live to bold the matching row.
  const hoveredRef = useRef<string | null>(null);
  const getHovered = useCallback(() => hoveredRef.current, []);
  // Outer graph box + the day-icon overlay, read by the mobile popup placement below.
  const graphRef = useRef<HTMLDivElement>(null);
  const graphDatesRef = useRef<HTMLDivElement>(null);

  // Fixed placement for the mobile stats popup: a bottom corner on the side AWAY from
  // the inspector line (so it never overlaps it); shifted up if it would run off the
  // bottom of the screen; but never rising above the bottom of the day-icon buttons.
  const scrubPos = useCallback<TooltipPositionFn>((point, _p, _dom, _rect, size) => {
    const [w, h] = size.contentSize;
    const [cw, ch] = size.viewSize;
    const M = 8;
    const putLeft = point[0] > cw / 2; // line on the right half ⇒ popup bottom-LEFT
    const x = putLeft ? M : Math.max(M, cw - w - M);
    let y = ch - h - M; // rest at the bottom of the plot
    const box = graphRef.current?.getBoundingClientRect();
    if (box) {
      const offBottom = box.top + y + h - (window.innerHeight - M);
      if (offBottom > 0) y -= offBottom; // shift up to stay on screen
    }
    const dates = graphDatesRef.current?.getBoundingClientRect();
    if (box && dates) {
      const capY = dates.bottom - box.top; // never above the day-icon buttons
      if (y < capY) y = capY;
    }
    return [x, y];
  }, []);

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
      air,
      airIndex,
      compact,
      mobile: compact,
      tooltipPosition: compact ? scrubPos : undefined,
      popoverHidden,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourly, units, series.join(","), effPanels.join(","), tempBand, precipBand, nowIso, currentIso, theme, integrated, (hidden ?? []).join(","), air, airIndex, compact, popoverHidden]);

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

  // Tie the axis tooltip ("hover details") to the shared readout so it and the day
  // popover can never be open at once. The tooltip only appears when the pointer is
  // over the plot (the day tiles sit on an overlay that captures the pointer, so it
  // gets no events there) — so `updateAxisPointer` with a real value means "hover
  // details are showing" → open the hover readout, which closes any day popover.
  // Leaving the chart (`globalout`) closes it again.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onAxis = (e: { axesInfo?: { value?: unknown }[] }) => {
      if (Array.isArray(e?.axesInfo) && e.axesInfo.some((a) => a && a.value != null)) {
        dispatch(openHover());
      }
    };
    const onOut = () => {
      dispatch(closeHover());
    };
    chart.on("updateAxisPointer", onAxis as (p: unknown) => void);
    chart.on("globalout", onOut);
    return () => {
      chart.off("updateAxisPointer", onAxis as (p: unknown) => void);
      chart.off("globalout", onOut);
    };
  }, [chartRef, dispatch]);

  // Mobile: the scrubber (not a touch on the graph) drives the inspector line + stats
  // popup — show them at the scrubbed index, or hide when it hasn't been engaged. Desktop
  // ignores this and keeps the follow-the-pointer tooltip. Re-runs on `option` so the tip
  // is re-shown after each data re-render (setOption clears it).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !compact) return;
    if (scrubIndex == null) {
      chart.dispatchAction({ type: "hideTip" });
      return;
    }
    const list = (chart.getOption().series ?? []) as { type?: string; name?: string; data?: unknown[] }[];
    const isLine = (s: { type?: string; name?: string }) =>
      s?.type === "line" && !!s.name && !s.name.startsWith("_");
    // Each line is split into a PAST and a FORECAST series, NaN-padded on the other side
    // of "now" — so a fixed series index only has a data point on one side and showTip
    // silently no-ops past it. Pick whichever segment actually has a finite value AT the
    // scrubbed index, so the line shows in the future as well as the past.
    const finiteAt = (s: { data?: unknown[] }) => {
      const v = s.data?.[scrubIndex];
      return typeof v === "number" && Number.isFinite(v);
    };
    let si = list.findIndex((s) => isLine(s) && finiteAt(s));
    if (si < 0) si = list.findIndex(isLine);
    if (si < 0) si = 0;
    chart.dispatchAction({ type: "showTip", seriesIndex: si, dataIndex: scrubIndex });
  }, [compact, scrubIndex, option, chartRef]);

  const resolvedHeight = integrated ? CHART_HEIGHT_INTEGRATED : height;

  // Whether the temperature panel is laid out (all temp lines off ⇒ it's dropped). Must
  // match the option builder so the tile overlay lines up with the chart grids.
  const showTempPanel = tempPanelVisible(series, hidden, effPanels);

  // Where the on-graph tiles sit: the temp panel's empty headroom, or — when there's no
  // temp panel — the reserved band above the first panel (see TILE_BAND).
  const band = useMemo(() => {
    if (!integrated) return null;
    const layout = computeHorizontalLayout(effPanels, {
      includeTemp: showTempPanel,
      tileBand: showTempPanel ? 0 : TILE_BAND,
    });
    if (!showTempPanel) return { top: LAYOUT_TOP_PAD, height: TILE_BAND };
    const temp = layout.grids[0];
    return { top: temp.top, height: temp.height * tempTopEmptyFraction() };
  }, [integrated, effPanels, showTempPanel]);

  return (
    <div className="meteogram-graph" style={{ position: "relative" }} ref={graphRef}>
      <div
        ref={ref}
        className="meteogram"
        style={{ height: resolvedHeight }}
        aria-label="Weather meteogram"
      />
      {integrated && band && daily ? (
        <div
          className="graph-dates"
          ref={graphDatesRef}
          style={{
            top: `calc(${band.top}% - ${DATE_BAND_PAD}px)`,
            height: `calc(${band.height}% + ${2 * DATE_BAND_PAD}px)`,
          }}
        >
          <ForecastHeader
            summaries={daily}
            units={units}
            todayKey={todayKey}
            windowStart={hourly.time[0]}
            windowEnd={hourly.time[hourly.time.length - 1]}
            dailyAir={dailyAir}
            airIndex={airIndex}
          />
        </div>
      ) : null}
    </div>
  );
}
