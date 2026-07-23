import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CurrentConditions } from "./CurrentConditions";
import { DailyStrip } from "./DailyStrip";
import { Meteogram } from "./Meteogram";
import { meteogramLegend } from "./meteogramOption";
import { AirQualityPanel } from "./AirQualityPanel";
import { useDashboardState } from "../hooks/useUrlState";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { chartPalette } from "../theme/palette";
import { useAirQuality, useEnsemble, useForecast } from "../hooks/useWeather";
import { MAX_FORECAST_DAYS, MAX_PAST_DAYS } from "../api/openMeteo";
import { computeBands, recenterBandOnLine, type Bands } from "../api/ensemble";
import {
  dailySummaries,
  dayList,
  extractHourly,
  findNowIndex,
  windowByDays,
  type HourlyPoint,
} from "../utils/series";
import { addDays, dayKey, formatMonthDay } from "../utils/format";
import { computeAqhiSeries } from "../utils/aqhi";
import type { Place } from "../api/types";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

const AXIS_GUTTER = 56; // matches the ECharts grid inset (left/right)

/** Snapshot one side's axis gutter from the chart canvas as a fixed overlay. */
function makeAxisMask(
  canvas: HTMLCanvasElement,
  side: "left" | "right",
  topPx: number,
  panelBg: string,
): HTMLCanvasElement {
  const rect = canvas.getBoundingClientRect();
  const dpr = rect.width > 0 ? canvas.width / rect.width : 1;
  const gw = Math.round(AXIS_GUTTER * dpr);
  const mask = document.createElement("canvas");
  mask.className = "axis-mask";
  mask.width = gw;
  mask.height = Math.round(rect.height * dpr);
  mask.style.width = `${AXIS_GUTTER}px`;
  mask.style.height = `${rect.height}px`;
  mask.style.top = `${topPx}px`;
  mask.style[side] = "0";
  const ctx = mask.getContext("2d");
  if (ctx) {
    // Opaque fill so plot lines sliding under the gutter stay hidden behind it.
    ctx.fillStyle = panelBg;
    ctx.fillRect(0, 0, mask.width, mask.height);
    const sx = side === "left" ? 0 : canvas.width - gw;
    ctx.drawImage(canvas, sx, 0, gw, mask.height, 0, 0, gw, mask.height);
  }
  return mask;
}

/** Reindex confidence bands onto an arbitrary time window (match by timestamp). */
function alignBands(windowTime: string[], bands: Bands): Bands {
  const idx = new Map(bands.time.map((t, i) => [t, i]));
  const pick = (arr: number[]) =>
    windowTime.map((t) => {
      const i = idx.get(t);
      return i == null ? NaN : arr[i];
    });
  return {
    time: windowTime,
    lower: pick(bands.lower),
    median: pick(bands.median),
    upper: pick(bands.upper),
  };
}

export function Dashboard({ place }: { place: Place }) {
  const { state, ...controls } = useDashboardState();
  const { theme } = useTheme();
  const isNarrow = useMediaQuery("(max-width: 640px)");
  const portrait = useMediaQuery("(max-width: 640px) and (orientation: portrait)");
  const legend = useMemo(
    () => meteogramLegend({ series: state.series, panels: state.panels, palette: chartPalette(theme) }),
    [state.series, state.panels, theme],
  );
  const animRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [clipping, setClipping] = useState(false);

  const windowDays = state.days;
  const offset = state.offset;
  // Fetch the whole timeline (92 days of history → 16-day forecast) up front as
  // one continuous forecast — only ~32 KB gzipped. Scrolling just slices a window
  // out of it, so panning into the past never triggers a refetch (which was what
  // made the chart jump: scroll, snap back to old data, then snap again on load).
  const pastDays = MAX_PAST_DAYS;

  const forecastQ = useForecast(place, { forecastDays: MAX_FORECAST_DAYS, pastDays });
  const ciEnabled = state.ci;
  const ensembleQ = useEnsemble(place, { forecastDays: MAX_FORECAST_DAYS, enabled: ciEnabled });
  const airEnabled = state.panels.includes("air");
  const airQ = useAirQuality(place, { forecastDays: 7, pastDays, enabled: airEnabled });

  const forecast = forecastQ.data;

  const full = useMemo(() => (forecast ? extractHourly(forecast) : null), [forecast]);
  const summaries = useMemo(() => (forecast ? dailySummaries(forecast) : []), [forecast]);
  const todayKey = forecast ? dayKey(forecast.current.time) : "";

  // Resolve the window against the days we actually have, so it stays full-width
  // and never runs past either end of the fetched range.
  const win = useMemo(() => {
    if (!full) return null;
    const days = dayList(full);
    if (days.length === 0) return null;
    const todayIdx = Math.max(0, days.indexOf(todayKey));
    const maxStart = Math.max(0, days.length - windowDays);
    const startIdx = clamp(todayIdx + offset, 0, maxStart);
    const endIdx = Math.min(startIdx + windowDays - 1, days.length - 1);
    return { startKey: days[startIdx], endKey: days[endIdx] };
  }, [full, todayKey, offset, windowDays]);

  const hourly: HourlyPoint | null = useMemo(
    () => (full && win ? windowByDays(full, win.startKey, win.endKey) : null),
    [full, win],
  );

  const tempBand = useMemo(() => {
    if (!ciEnabled || !ensembleQ.data || !hourly) return null;
    const raw = alignBands(hourly.time, computeBands(ensembleQ.data, "temperature_2m"));
    return recenterBandOnLine(raw, hourly.temperature);
  }, [ciEnabled, ensembleQ.data, hourly]);

  const precipBand = useMemo(() => {
    if (!ciEnabled || !ensembleQ.data || !hourly) return null;
    const raw = alignBands(hourly.time, computeBands(ensembleQ.data, "precipitation"));
    return recenterBandOnLine(raw, hourly.precipitation);
  }, [ciEnabled, ensembleQ.data, hourly]);

  // Canadian AQHI per hour, aligned to the air-quality series.
  const aqhi = useMemo(
    () => (airQ.data ? computeAqhiSeries(airQ.data.hourly) : null),
    [airQ.data],
  );
  const currentAqhi = useMemo(() => {
    if (!aqhi || !airQ.data || !forecast) return null;
    const i = findNowIndex(airQ.data.hourly.time, forecast.current.time);
    return i >= 0 ? aqhi[i] : null;
  }, [aqhi, airQ.data, forecast]);

  // Hourly temperature from 2am yesterday → 2am tomorrow for the today-panel graph.
  const miniWindow = useMemo(() => {
    if (!full || !forecast) return null;
    const tk = dayKey(forecast.current.time);
    const start = `${addDays(tk, -1)}T02:00`;
    const end = `${addDays(tk, 1)}T02:00`;
    const time: string[] = [];
    const temperature: number[] = [];
    for (let i = 0; i < full.time.length; i++) {
      const t = full.time[i];
      if (t >= start && t <= end) {
        time.push(t);
        temperature.push(full.temperature[i]);
      }
    }
    return time.length > 1 ? { time, temperature } : null;
  }, [full, forecast]);

  if (forecastQ.isLoading && !forecast) {
    return <div className="state state--loading">Loading forecast for {place.name}…</div>;
  }
  if (forecastQ.isError || !forecast) {
    return (
      <div className="state state--error">
        <p>Couldn’t load the forecast.</p>
        <p className="state__detail">{(forecastQ.error as Error)?.message}</p>
        <button className="btn" onClick={() => forecastQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const today = summaries.find((s) => s.date === todayKey);
  const startKey = win?.startKey ?? todayKey;
  const endKey = win?.endKey ?? todayKey;
  const windowSummaries = summaries.filter((s) => s.date >= startKey && s.date <= endKey);
  const nowInWindow = todayKey >= startKey && todayKey <= endKey;
  const nowIso = nowInWindow ? forecast.current.time : null;

  // Scroll bounds against the absolute available range (past 92 → future 16).
  const minOffset = -MAX_PAST_DAYS;
  const maxOffset = Math.max(0, MAX_FORECAST_DAYS - windowDays);
  const step = Math.max(1, Math.min(2, windowDays));

  // Pan the window by a couple of days. Only the plot slides — the axis scales
  // stay put: the sliding chart's own gutters are clipped out and replaced by
  // fixed snapshots of the settled (already-rescaled) axes. So the axes may snap
  // to a new scale, then the ~8 overlapping days of a 10-day window glide over.
  function slide(dir: number) {
    const dest = clamp(offset + dir * step, minOffset, maxOffset);
    if (busyRef.current || dest === offset) return;
    const el = animRef.current;
    const viewport = el?.parentElement;
    const n = hourly?.time.length ?? 0;
    const plotW = (el?.offsetWidth ?? 0) - 2 * AXIS_GUTTER;
    // Vertical (portrait) layout or an unmeasurable chart → just swap, no slide.
    if (portrait || !el || !viewport || plotW <= 0 || n < 2) {
      controls.setOffset(dest);
      return;
    }
    const delta = ((Math.abs(dest - offset) * 24) / (n - 1)) * plotW;
    busyRef.current = true;
    setClipping(true);
    // Swap to the destination window synchronously so the snapshot below captures
    // the final, already-rescaled axes.
    flushSync(() => controls.setOffset(dest));

    const canvas = el.querySelector("canvas") as HTMLCanvasElement | null;
    const masks: HTMLCanvasElement[] = [];
    if (canvas) {
      const panelBg =
        getComputedStyle(el.closest(".panel") ?? el).backgroundColor || "#fff";
      const top = canvas.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      masks.push(makeAxisMask(canvas, "left", top, panelBg));
      masks.push(makeAxisMask(canvas, "right", top, panelBg));
      masks.forEach((m) => viewport.appendChild(m));
      // Hide the chart's own (moving) gutters so only the plot band slides.
      el.style.clipPath = `inset(0 ${AXIS_GUTTER}px 0 ${AXIS_GUTTER}px)`;
    }

    el.style.transition = "none";
    el.style.transform = `translateX(${dir * delta}px)`;
    void el.offsetWidth; // reflow so the start offset takes before the transition
    el.style.transition = "transform 200ms ease-out";
    el.style.transform = "translateX(0)";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      el.removeEventListener("transitionend", done);
      el.style.transition = "";
      el.style.transform = "";
      el.style.clipPath = "";
      masks.forEach((m) => m.remove());
      setClipping(false);
      busyRef.current = false;
    };
    const fallback = setTimeout(done, 320); // in case transitionend never fires
    el.addEventListener("transitionend", done);
  }

  const hasHourly = !!hourly && hourly.time.length > 0;
  // Wide screens draw the day/date + icon on the temperature graph (hover a day
  // for the full card). Narrow screens keep the standalone strip.
  const integrated = !isNarrow;
  const emptyState = <div className="state state--empty">No data for this range.</div>;

  return (
    <div className="dashboard">
      <CurrentConditions
        place={place}
        current={forecast.current}
        today={today}
        units={state.units}
        aqhi={currentAqhi}
        mini={miniWindow}
      />

      <div className="panel meteogram-panel meteogram-panel--forecast">
        <div className="meteogram-nav">
          <button
            type="button"
            className="meteogram-nav__range"
            onClick={() => controls.setOffset(0)}
            disabled={offset === 0}
            title="Jump back to today"
          >
            {formatMonthDay(startKey)} – {formatMonthDay(endKey)}
          </button>
        </div>

        {!integrated ? (
          <DailyStrip summaries={windowSummaries} units={state.units} todayKey={todayKey} />
        ) : null}

        <div className="meteogram-scroller">
          <button
            type="button"
            className="scroll-edge"
            onClick={() => slide(-1)}
            disabled={offset <= minOffset}
            aria-label="Scroll to earlier days"
            title="Earlier days — scroll back through recorded history"
          >
            <span aria-hidden="true">‹</span>
          </button>

          <div className={"meteogram-viewport" + (clipping ? " is-clipping" : "")}>
            <div className="meteogram-anim" ref={animRef}>
              {hasHourly ? (
                <Meteogram
                  hourly={hourly!}
                  units={state.units}
                  series={state.series}
                  panels={state.panels}
                  tempBand={tempBand}
                  precipBand={precipBand}
                  nowIso={nowIso}
                  vertical={portrait}
                  daily={integrated ? windowSummaries : undefined}
                  todayKey={todayKey}
                />
              ) : (
                emptyState
              )}
            </div>
          </div>

          <button
            type="button"
            className="scroll-edge"
            onClick={() => slide(1)}
            disabled={offset >= maxOffset}
            aria-label="Scroll to later days"
            title="Later days — scroll forward through the forecast"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        {legend.length ? (
          <div className="chart-legend" role="list">
            {legend.map((l) => (
              <span key={l.name} role="listitem" className="legend-item">
                <span className="legend-swatch" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        ) : null}

        {ciEnabled ? (
          <p className="ci-note">
            Shaded bands show the 10–90% ensemble range (ECMWF IFS){" "}
            {ensembleQ.isFetching ? "· loading…" : ""}
          </p>
        ) : null}
      </div>

      {airEnabled ? (
        airQ.data && aqhi ? (
          <AirQualityPanel
            data={airQ.data}
            aqhi={aqhi}
            startKey={startKey}
            endKey={endKey}
            nowIso={nowInWindow ? forecast.current.time : `${startKey}T12:00`}
          />
        ) : airQ.isLoading ? (
          <div className="state state--loading">Loading air quality…</div>
        ) : null
      ) : null}
    </div>
  );
}
