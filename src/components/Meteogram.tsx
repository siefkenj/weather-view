import { useMemo } from "react";
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

  const option = useMemo(() => {
    const build = vertical ? buildVerticalMeteogramOption : buildMeteogramOption;
    return build({
      hourly,
      palette: chartPalette(theme),
      units,
      series,
      panels,
      tempBand,
      precipBand,
      nowIso,
      headroom: integrated,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourly, units, series.join(","), panels.join(","), tempBand, precipBand, nowIso, theme, vertical, integrated]);

  const ref = useECharts(option);

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
