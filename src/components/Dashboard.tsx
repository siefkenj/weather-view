import { useCallback, useMemo, useRef, useState } from "react";
import { CurrentConditions } from "./CurrentConditions";
import { Meteogram } from "./Meteogram";
import { meteogramLegend } from "./meteogramOption";
import { AirQualityPanel } from "./AirQualityPanel";
import { useDashboardState } from "../hooks/useUrlState";
import { useTheme } from "../hooks/useTheme";
import { chartPalette } from "../theme/palette";
import { FULL_PAST_DAYS, useLocationWeather } from "../hooks/useWeather";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import { computeBands, recenterBandOnLine } from "../api/ensemble";
import {
  dailySummaries,
  extractHourly,
  findNowIndex,
  windowByTime,
  type HourlyPoint,
} from "../utils/series";
import {
  interpBands,
  interpNullable,
  refineHourlyWindow,
  sliceFine,
  toFineSamples,
} from "../utils/refine";
import { addDays, dayKey, formatMonthDay, parseLocal, todayInZone } from "../utils/format";
import { arrowTarget, clampStartIso, shiftStart } from "../utils/pan";
import { computeAqhiSeries } from "../utils/aqhi";
import type { Place } from "../api/types";

// At/below this window width, the meteogram is refined onto the 15-minute grid
// (native near-term data covers ~2 days; finer detail is invisible beyond that).
const REFINE_MAX_DAYS = 2;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

const AXIS_GUTTER = 56; // matches the ECharts grid inset (left/right)
const DAY_MS = 86_400_000;
const ARROW_TWEEN_MS = 240;
// Narrow screens show fewer days so each stays at least this wide (readable tiles).
const MIN_DAY_PX = 48;

export function Dashboard({ place }: { place: Place }) {
  const { state, ...controls } = useDashboardState();
  const { theme } = useTheme();
  const animRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  // Callback ref on the chart element: keep `animRef` (for imperative reads) and a
  // reactive width (to decide how many days fit) in sync via a ResizeObserver.
  const setAnim = useCallback((el: HTMLDivElement | null) => {
    animRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setChartWidth(el.offsetWidth);
    const ro = new ResizeObserver(() => animRef.current && setChartWidth(animRef.current.offsetWidth));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const tweenRaf = useRef<number | null>(null);
  // Live pan bookkeeping for an in-progress mouse/touch drag (see onPointer* below).
  const gesture = useRef<{
    x0: number;
    dx: number;
    started: boolean;
    dayPx: number;
    base: string;
    minStart: string;
    maxStart: string;
    raf: number | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Local, uncommitted window start used while panning (drag or arrow tween). It
  // overrides the committed `viewStart` so the chart re-renders with real data as
  // you scroll, without touching redux/URL until the motion settles.
  const [dragStart, setDragStart] = useState<string | null>(null);
  // Panel sub-lines hidden via the legend (temperature series use state.series).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggleHidden = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Cap the visible days so each column stays at least MIN_DAY_PX wide — a thin
  // screen shows fewer days rather than squeezing them illegibly. Before the chart
  // is measured (chartWidth 0) we fall back to the requested count.
  const plotW = chartWidth - 2 * AXIS_GUTTER;
  const maxDays = plotW > 0 ? Math.max(1, Math.floor(plotW / MIN_DAY_PX)) : state.days;
  const windowDays = Math.min(state.days, maxDays);
  const ciEnabled = state.ci;
  const airEnabled = state.panels.includes("air");

  // What the first (fast) load must cover: the visible window, expressed relative to
  // today (estimated from the location's zone before any data has arrived). On a
  // fresh load that's just today → today + days; a restored/scrolled URL widens it.
  const initial = useMemo(() => {
    const today = todayInZone(place.timezone);
    const startDay = state.viewStart ? dayKey(state.viewStart) : today;
    const endDay = addDays(startDay, windowDays);
    const fwd = Math.round((parseLocal(endDay).getTime() - parseLocal(today).getTime()) / DAY_MS);
    const back = Math.round((parseLocal(today).getTime() - parseLocal(startDay).getTime()) / DAY_MS);
    return {
      initialForecastDays: clamp(fwd + 1, windowDays, MAX_FORECAST_DAYS),
      initialPastDays: clamp(back + 1, 0, FULL_PAST_DAYS),
    };
  }, [place.timezone, state.viewStart, windowDays]);

  // All weather for this location, grouped as sub-objects under its lon,lat key.
  // Each field is an independent RTK Query result (own data/loading/error); the
  // forecast loads in two stages (visible window first, then the whole range).
  // `ci`/`air` gate the two optional sources.
  const wx = useLocationWeather(place, { ci: ciEnabled, air: airEnabled, ...initial });
  const forecastQ = wx.forecast;
  const ensembleQ = wx.ensemble;
  const airQ = wx.airQuality;
  const minutelyQ = wx.minutely;

  const forecast = forecastQ.data;
  const fine = useMemo(
    () => (minutelyQ.data ? toFineSamples(minutelyQ.data.minutely_15) : null),
    [minutelyQ.data],
  );

  const full = useMemo(() => (forecast ? extractHourly(forecast) : null), [forecast]);
  const summaries = useMemo(() => (forecast ? dailySummaries(forecast) : []), [forecast]);
  const todayKey = forecast ? dayKey(forecast.current.time) : "";

  // Resolve the window's left edge (a continuous datetime) against the data we have,
  // so it stays full-width and never runs past either end of the fetched range.
  // `dragStart` (a live pan) takes precedence over the committed `viewStart`; `null`
  // = auto-anchor to today. Clamped here where the fetched range is known.
  const activeViewStart = dragStart ?? state.viewStart;
  const win = useMemo(() => {
    if (!full || full.time.length === 0) return null;
    const firstDay = dayKey(full.time[0]);
    const lastDay = dayKey(full.time[full.time.length - 1]);
    const minStart = `${firstDay}T00:00`;
    const maxDay = addDays(lastDay, -(windowDays - 1));
    const maxStart = maxDay > firstDay ? `${maxDay}T00:00` : minStart;
    const candidate = activeViewStart ?? `${todayKey || firstDay}T00:00`;
    return { start: clampStartIso(candidate, minStart, maxStart), minStart, maxStart };
  }, [full, todayKey, activeViewStart, windowDays]);

  const hourly: HourlyPoint | null = useMemo(
    () => (full && win ? windowByTime(full, win.start, windowDays) : null),
    [full, win, windowDays],
  );

  // When zoomed in (≤2 days) and 15-min data covers the window, refine the whole
  // window onto the 15-minute grid — native temperature / feels-like / precip, the
  // rest interpolated. Falls back to hourly when uncovered. Everything below aligns
  // to chartHourly.time so bands and AQHI ride the same grid.
  const chartHourly: HourlyPoint | null = useMemo(() => {
    if (!hourly) return null;
    if (windowDays > REFINE_MAX_DAYS || !fine) return hourly;
    return refineHourlyWindow(hourly, fine) ?? hourly;
  }, [hourly, windowDays, fine]);
  const refined = !!chartHourly && !!hourly && chartHourly !== hourly;

  const tempBand = useMemo(() => {
    if (!ciEnabled || !ensembleQ.data || !chartHourly) return null;
    const raw = interpBands(chartHourly.time, computeBands(ensembleQ.data, "temperature_2m"));
    return recenterBandOnLine(raw, chartHourly.temperature);
  }, [ciEnabled, ensembleQ.data, chartHourly]);

  const precipBand = useMemo(() => {
    if (!ciEnabled || !ensembleQ.data || !chartHourly) return null;
    const raw = interpBands(chartHourly.time, computeBands(ensembleQ.data, "precipitation"));
    return recenterBandOnLine(raw, chartHourly.precipitation);
  }, [ciEnabled, ensembleQ.data, chartHourly]);

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

  // The current weather day (2am → 2am) that contains "now", for the today-panel
  // graph. Before 2am the day belongs to the previous calendar date. Uses the
  // 15-minute grid when it covers the day, else falls back to hourly.
  const miniWindow = useMemo(() => {
    if (!full || !forecast) return null;
    const nowIsoTime = forecast.current.time;
    const dayStart =
      Number(nowIsoTime.slice(11, 13)) < 2 ? addDays(dayKey(nowIsoTime), -1) : dayKey(nowIsoTime);
    const start = `${dayStart}T02:00`;
    const end = `${addDays(dayStart, 1)}T02:00`;
    let time: string[] = [];
    let temperature: number[] = [];
    let apparent: number[] = [];
    const slice = fine ? sliceFine(fine, start, end) : null;
    if (slice) {
      ({ time, temperature, apparent } = slice);
    } else {
      for (let i = 0; i < full.time.length; i++) {
        const t = full.time[i];
        if (t >= start && t <= end) {
          time.push(t);
          temperature.push(full.temperature[i]);
          apparent.push(full.apparent[i]);
        }
      }
    }
    const daySummary = summaries.find((s) => s.date === dayStart);
    return time.length > 1
      ? { time, temperature, apparent, dayKey: dayStart, sunrise: daySummary?.sunrise, sunset: daySummary?.sunset }
      : null;
  }, [full, forecast, summaries, fine]);

  // AQHI aligned to the meteogram window's grid (interpolated onto the 15-minute
  // grid when refined). Undefined when the window has no air-quality coverage.
  const aqhiWindow = useMemo(() => {
    if (!airEnabled || !aqhi || !airQ.data || !chartHourly) return undefined;
    const aligned = interpNullable(airQ.data.hourly.time, aqhi, chartHourly.time);
    return aligned.some((v) => v != null) ? aligned : undefined;
  }, [airEnabled, aqhi, airQ.data, chartHourly]);

  const legend = useMemo(
    () => meteogramLegend({ panels: state.panels, palette: chartPalette(theme), hasAir: !!aqhiWindow }),
    [state.panels, theme, aqhiWindow],
  );
  // A panel is drawn only while at least one of its lines is shown (the legend is
  // now the only control — the settings chips are gone), and air needs its data.
  const chartPanels = state.panels.filter((p) => {
    if (p === "precip") return !hidden.has("Precipitation") || !hidden.has("Chance of precip");
    if (p === "atmo") return !hidden.has("Cloud cover") || !hidden.has("Humidity") || !hidden.has("Pressure");
    if (p === "air") return !!aqhiWindow && !hidden.has("Air quality");
    return true;
  });

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
  const startKey = win ? dayKey(win.start) : todayKey;
  const lastTime = hourly && hourly.time.length ? hourly.time[hourly.time.length - 1] : null;
  const endKey = lastTime ? dayKey(lastTime) : startKey;
  const windowSummaries = summaries.filter((s) => s.date >= startKey && s.date <= endKey);
  const curTime = forecast.current.time;
  const nowInWindow =
    !!hourly && hourly.time.length > 0 && curTime >= hourly.time[0] && curTime <= hourly.time[hourly.time.length - 1];
  const nowIso = nowInWindow ? curTime : null;

  const anchored = state.viewStart == null && dragStart == null;
  const atStart = win ? win.start <= win.minStart : true;
  const atEnd = win ? win.start >= win.maxStart : true;

  // ---- Panning ---------------------------------------------------------
  // Both the drag and the arrow tween pan by re-rendering the window live (the chart
  // always shows the data that's loaded — no blank block). The committed viewStart
  // is written to redux/URL only when the motion settles.

  /** Grid px per day at the current resolution (24 hourly / 96 on the 15-min grid). */
  function dayPx(): number | null {
    const el = animRef.current;
    const t = chartHourly?.time ?? [];
    const n = t.length;
    const plotW = (el?.offsetWidth ?? 0) - 2 * AXIS_GUTTER;
    if (n < 2 || plotW <= 0) return null;
    const stepMin = (parseLocal(t[1]).getTime() - parseLocal(t[0]).getTime()) / 60000;
    const perDay = stepMin > 0 ? 1440 / stepMin : 24;
    return (perDay / (n - 1)) * plotW;
  }

  const cancelTween = () => {
    if (tweenRaf.current != null) cancelAnimationFrame(tweenRaf.current);
    tweenRaf.current = null;
  };

  // Arrow buttons: ease a day-quantised (≥12.5h) jump, re-rendering each frame, then
  // commit on settle.
  function pan(dir: number) {
    if (gesture.current || tweenRaf.current != null || !win) return;
    const target = clampStartIso(arrowTarget(win.start, dir), win.minStart, win.maxStart);
    if (target === win.start) return;
    const from = win.start;
    const { minStart: lo, maxStart: hi } = win;
    const totalDays = (parseLocal(target).getTime() - parseLocal(from).getTime()) / DAY_MS;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ARROW_TWEEN_MS);
      const ease = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setDragStart(clampStartIso(shiftStart(from, totalDays * ease), lo, hi));
        tweenRaf.current = requestAnimationFrame(step);
      } else {
        tweenRaf.current = null;
        controls.setViewStart(target);
        setDragStart(null);
      }
    };
    tweenRaf.current = requestAnimationFrame(step);
  }

  // Mouse/touch drag: pan continuously; the gesture starts once the pointer moves
  // past a small threshold (so a plain click doesn't trigger it). Pointer-moves are
  // coalesced to one re-render per animation frame.
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || gesture.current || tweenRaf.current != null || !win) return;
    const px = dayPx();
    if (px == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      x0: e.clientX,
      dx: 0,
      started: false,
      dayPx: px,
      base: win.start,
      minStart: win.minStart,
      maxStart: win.maxStart,
      raf: null,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    g.dx = e.clientX - g.x0;
    if (!g.started) {
      if (Math.abs(g.dx) < 4) return;
      g.started = true;
      setDragging(true);
    }
    if (g.raf == null) {
      g.raf = requestAnimationFrame(() => {
        const gg = gesture.current;
        if (!gg) return;
        gg.raf = null;
        setDragStart(clampStartIso(shiftStart(gg.base, -gg.dx / gg.dayPx), gg.minStart, gg.maxStart));
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.raf != null) cancelAnimationFrame(g.raf);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!g.started) return; // was a click, not a pan
    setDragging(false);
    const final = clampStartIso(shiftStart(g.base, -g.dx / g.dayPx), g.minStart, g.maxStart);
    controls.setViewStart(final);
    setDragStart(null);
  }

  const hasHourly = !!chartHourly && chartHourly.time.length > 0;
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
            onClick={() => {
              cancelTween();
              setDragStart(null);
              controls.setViewStart(null);
            }}
            disabled={anchored}
            title="Jump back to today"
          >
            {formatMonthDay(startKey)} – {formatMonthDay(endKey)}
          </button>
          {refined ? (
            <span className="meteogram-nav__res" title="Showing 15-minute detail for the near term (temperature, feels-like, and precipitation).">
              15-min
            </span>
          ) : null}
        </div>

        <div className="meteogram-scroller">
          <button
            type="button"
            className="scroll-edge"
            onClick={() => pan(-1)}
            disabled={atStart}
            aria-label="Scroll to earlier days"
            title="Earlier days — scroll back through recorded history"
          >
            <span aria-hidden="true">‹</span>
          </button>

          <div
            className={"meteogram-viewport" + (dragging ? " is-dragging" : "")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="meteogram-anim" ref={setAnim}>
              {hasHourly ? (
                <Meteogram
                  hourly={chartHourly!}
                  units={state.units}
                  series={state.series}
                  panels={chartPanels}
                  tempBand={tempBand}
                  precipBand={precipBand}
                  nowIso={nowIso}
                  currentIso={forecast.current.time}
                  daily={windowSummaries}
                  todayKey={todayKey}
                  hidden={[...hidden]}
                  aqhi={aqhiWindow}
                />
              ) : (
                emptyState
              )}
            </div>
          </div>

          <button
            type="button"
            className="scroll-edge"
            onClick={() => pan(1)}
            disabled={atEnd}
            aria-label="Scroll to later days"
            title="Later days — scroll forward through the forecast"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        {legend.length ? (
          <div className="chart-legend" role="group" aria-label="Show or hide chart series">
            {legend.map((l) => {
              const active = l.kind === "series" ? state.series.includes(l.seriesKey) : !hidden.has(l.name);
              const onClick = () =>
                l.kind === "series" ? controls.toggleSeries(l.seriesKey) : toggleHidden(l.name);
              return (
                <button
                  key={l.name}
                  type="button"
                  className={"legend-item legend-item--btn" + (active ? "" : " legend-item--off")}
                  aria-pressed={active}
                  title={`${l.help}\n\n(${active ? "click to hide" : "click to show"})`}
                  onClick={onClick}
                >
                  <span
                    className="legend-swatch"
                    style={active ? { background: l.color, borderColor: l.color } : { borderColor: l.color }}
                  />
                  {l.name}
                </button>
              );
            })}
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
            nowIso={nowInWindow ? forecast.current.time : `${startKey}T12:00`}
          />
        ) : airQ.isLoading ? (
          <div className="state state--loading">Loading air quality…</div>
        ) : null
      ) : null}
    </div>
  );
}
