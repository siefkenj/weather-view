import { useEffect, useRef, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { LocationSearch, type LocationSearchHandle } from "./LocationSearch";
import { SettingsMenu } from "./SettingsMenu";
import { StatusBar } from "./StatusBar";
import { formatTemp, roundOrDash, type Units } from "../utils/units";
import { dayKey, formatTime, formatWeekdayLong, parseLocal } from "../utils/format";
import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { formatWindSpeed, windCompass } from "../utils/wind";
import { WindArrow } from "./WindArrow";
import { isDaytime, type DailySummary } from "../utils/series";
import type { ConsensusMeta, ForecastCurrent, Place } from "../api/types";
import { modelLabel } from "../utils/models";
import { placeLabel, placeToSlug } from "../utils/place";
import { addRecentPlace } from "../utils/recentPlaces";

interface Props {
  place: Place;
  current: ForecastCurrent;
  today?: DailySummary;
  units: Units;
  aqhi?: number | null;
  aqi?: number | null;
  /** Present when the forecast is a multi-model blend — drives the "consensus" note. */
  consensus?: ConsensusMeta;
  /** Hourly data across one local calendar day (midnight→midnight) for the mini graph
   *  (°C). `dayKey` is the day the high/low markers belong to; sunrise/sunset drive the
   *  shading. */
  mini?: {
    time: string[];
    temperature: number[];
    apparent: number[];
    dayKey: string;
    sunrise?: string;
    sunset?: string;
  } | null;
}

/** US AQI is a 0–500 integer; "–" when unavailable. */
const formatAqi = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? String(Math.round(v)) : "–";

/** Daily rain as amount + chance, e.g. "2.4mm (60%)". Always in mm, like the chart. */
function formatRain(mm: number | null | undefined, chance: number | null | undefined): string {
  const amt = mm != null && Number.isFinite(mm) ? mm : 0;
  const pct = chance != null && Number.isFinite(chance) ? Math.round(chance) : 0;
  const a = amt <= 0 ? "0" : amt < 10 ? amt.toFixed(1) : String(Math.round(amt));
  return `${a}mm (${pct}%)`;
}

export function CurrentConditions({ place, current, today, units, aqhi, aqi, mini, consensus }: Props) {
  // The headline condition summarizes the whole of today (matching the forecast
  // strip's "Today" tile), not the current instant — so a dry gap between showers
  // still reads as a rainy day. Temperature and feels-like below stay live. Falls
  // back to the current code until the daily summary has loaded.
  const wx = describeWeather(today?.code ?? current.weather_code);
  const day = isDaytime(current.time, today?.sunrise, today?.sunset);
  const cat = aqhi != null && Number.isFinite(aqhi) ? aqhiCategory(aqhi) : null;
  const hasAir =
    (aqhi != null && Number.isFinite(aqhi)) || (aqi != null && Number.isFinite(aqi));
  const hasMini = mini && mini.time.length > 1;
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<LocationSearchHandle>(null);
  const currentKey = placeToSlug(place);

  // Remember every viewed location (not just search-picked ones — this also covers the
  // default city and links opened by URL) so the search box can offer recents on click.
  useEffect(() => {
    addRecentPlace(place);
    // Keyed on the slug so we record once per distinct location, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // The card doubles as the app header: switching cities keeps the query string
  // (visible-forecast state) and carries the rich place in router state.
  function goToPlace(p: Place) {
    navigate(`/${placeToSlug(p)}${location.search}`, { state: { place: p } });
  }

  return (
    <section className="current" aria-label="Current conditions">
      <StatusBar />
      <div className="current__actions">
        <LocationSearch ref={searchRef} onSelect={goToPlace} currentKey={currentKey} />
        <SettingsMenu />
      </div>
      <div className="current__today">
        <div className="current__date">{formatWeekdayLong(current.time)}</div>
        <button
          type="button"
          className="current__place"
          onClick={() => searchRef.current?.open()}
          title="Change location"
        >
          {placeLabel(place)}
        </button>
        <div className="current__main">
          <WeatherIcon kind={wx.icon} night={!day} size={84} title={wx.label} />
          <div className="current__temp-block">
            <div className="current__temp">{formatTemp(current.temperature_2m, units, 0)}</div>
            <div className="current__label">{wx.label}</div>
            <div className="current__feels">Feels like {formatTemp(current.apparent_temperature, units, 0)}</div>
            {consensus ? <ConsensusNote consensus={consensus} /> : null}
          </div>
        </div>
      </div>
      <div className="current__meta">
        {today ? (
          <div className="current__day">
            {hasMini ? (
              // The day trace sits to the LEFT of the facts; the facts fill the space to
              // its right and center on their line.
              <div className="fact fact--graph">
                <span className="fact-key">Today</span>
                <TempMiniGraph
                  time={mini!.time}
                  temperature={mini!.temperature}
                  apparent={mini!.apparent}
                  todayKey={mini!.dayKey}
                  sunrise={mini!.sunrise}
                  sunset={mini!.sunset}
                  nowIso={current.time}
                  nowTemp={current.temperature_2m}
                  units={units}
                />
              </div>
            ) : null}
            <ul className="current__facts">
            <li>
              <span className="fact-key">UV max</span>
              <span className="fact-val">{roundOrDash(today.uvMax)}</span>
            </li>
            <li>
              <span className="fact-key">Rain</span>
              <span className="fact-val">{formatRain(today.precipSum, today.precipProbMax)}</span>
            </li>
            <li>
              <span className="fact-key">Wind</span>
              <span className="fact-val">
                {formatWindSpeed(today.windMax)}
                {Number.isFinite(today.windMax) && Number.isFinite(today.windDir) ? (
                  <>
                    {" "}
                    <WindArrow deg={today.windDir} /> {windCompass(today.windDir)}
                  </>
                ) : null}
              </span>
            </li>
            <li>
              <span className="fact-key">Sunrise</span>
              <span className="fact-val">{formatTime(today.sunrise)}</span>
            </li>
            <li>
              <span className="fact-key">Sunset</span>
              <span className="fact-val">{formatTime(today.sunset)}</span>
            </li>
            {hasAir ? (
              <li className="fact fact--air" title={cat?.message}>
                <span className="fact-key">AQHI (AQI)</span>
                <span className="fact-val">
                  {formatAqhi(aqhi)} ({formatAqi(aqi)})
                </span>
                {cat ? (
                  <span className="aqi-chip aqi-chip--sm" style={{ background: cat.color }}>
                    {cat.short}
                  </span>
                ) : null}
              </li>
            ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A small note under the condition label when the forecast blends several models,
 *  explaining how today was decided — e.g. "Consensus of 6 models · 4 of 6 show a
 *  wet day". */
function ConsensusNote({ consensus }: { consensus: ConsensusMeta }) {
  const { models, wet, agree, total } = consensus;
  const verb = wet ? "show a wet day" : "show a dry day";
  const vote = total > 0 ? ` · ${agree} of ${total} ${verb}` : "";
  return (
    <div
      className="current__consensus"
      title={`Blended from ${models.length} models: ${models.map(modelLabel).join(", ")}.`}
    >
      Consensus of {models.length} models{vote}
    </div>
  );
}

interface MiniProps {
  time: string[];
  temperature: number[];
  apparent: number[];
  todayKey: string;
  sunrise?: string;
  sunset?: string;
  nowIso: string;
  nowTemp: number;
  units: Units;
}

// The day/night background is now drawn with a CSS gradient (`.temp-mini__sky`
// in index.css). JS only supplies the sunrise/sunset positions as CSS custom
// properties (`--sunrise` / `--sunset`); the colours live in `--sky-day` /
// `--sky-night` and the twilight-band width in `--sky-twilight`. The gradient is
// a close approximation of the perceptual daylight model, not a per-pixel render.

/** Position (0..100 %) of a local ISO time across the [start, end] window. */
function windowPct(iso: string, startMs: number, spanMs: number): number {
  const p = ((parseLocal(iso).getTime() - startMs) / spanMs) * 100;
  return Math.max(0, Math.min(100, p));
}

/** Compact temperature trace over one local calendar day: solar-lit background, actual
 *  (solid) past vs forecast (faded) future, today's high/low, and — only where it
 *  diverges by >2°C — a dashed "feels like" line. */
function TempMiniGraph({
  time,
  temperature,
  apparent,
  todayKey,
  sunrise,
  sunset,
  nowIso,
  nowTemp,
  units,
}: MiniProps) {
  const n = time.length;

  // Feels-like shown only where |feels − temp| > 2 °C.
  const showFeels = (i: number) => Number.isFinite(apparent[i]) && Math.abs(apparent[i] - temperature[i]) > 2;

  const values = [...temperature.filter(Number.isFinite), nowTemp];
  for (let i = 0; i < n; i++) if (showFeels(i)) values.push(apparent[i]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const W = 168;
  const H = 48;
  const padX = 4;
  const padTop = 13;
  const padBottom = 12;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const x = (i: number) => padX + (i / (n - 1)) * innerW;
  const y = (v: number) => padTop + (1 - (v - min) / span) * innerH;
  const clampX = (px: number) => Math.max(16, Math.min(px, W - 16));
  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  // Split the temperature line at "now" (spliced to the live observation): the
  // past is actual (solid), the future is forecast (faded). Positioned by real
  // timestamps so it's correct whether `time` is hourly or the 15-minute grid.
  const tms = time.map((t) => parseLocal(t).getTime());
  const nowMs = parseLocal(nowIso).getTime();
  let k = -1;
  for (let i = 0; i < n; i++) if (tms[i] <= nowMs) k = i;
  const nowFrac =
    k >= 0 && k < n - 1 ? k + (nowMs - tms[k]) / (tms[k + 1] - tms[k]) : Math.max(0, k);
  const nowX = padX + (nowFrac / (n - 1)) * innerW;

  const past: [number, number][] = [];
  const future: [number, number][] = [];
  for (let i = 0; i <= k; i++) past.push([x(i), y(temperature[i])]);
  if (k >= 0) {
    past.push([nowX, y(nowTemp)]);
    future.push([nowX, y(nowTemp)]);
  }
  for (let i = Math.max(0, k + 1); i < n; i++) future.push([x(i), y(temperature[i])]);

  // Dashed feels-like, only over contiguous runs where it diverges by >2 °C, and
  // split at "now" so the past is thin and the forecast is thick.
  const feelsPast: [number, number][][] = [];
  const feelsFut: [number, number][][] = [];
  let segP: [number, number][] = [];
  let segF: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (showFeels(i)) {
      const pt: [number, number] = [x(i), y(apparent[i])];
      if (i <= k) segP.push(pt);
      if (i >= k) segF.push(pt); // share the boundary point so the runs connect
    } else {
      if (segP.length >= 2) feelsPast.push(segP);
      if (segF.length >= 2) feelsFut.push(segF);
      segP = [];
      segF = [];
    }
  }
  if (segP.length >= 2) feelsPast.push(segP);
  if (segF.length >= 2) feelsFut.push(segF);

  // Today's high & low (restricted to today's hours).
  let hiI = -1;
  let loI = -1;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < n; i++) {
    if (dayKey(time[i]) !== todayKey) continue;
    const v = temperature[i];
    if (!Number.isFinite(v)) continue;
    if (v > hi) { hi = v; hiI = i; }
    if (v < lo) { lo = v; loI = i; }
  }

  // Daylight background: the sunrise/sunset positions (0..100 %) become CSS
  // variables; the CSS gradient in `.temp-mini__sky` turns them into the
  // night→day→night shading. Only drawn when both sun times are known.
  const t0 = parseLocal(time[0]).getTime();
  const winSpan = parseLocal(time[n - 1]).getTime() - t0;

  // Faint vertical guides every 3 hours (03:00, 06:00 … 21:00) across the calendar-day
  // window, positioned by real elapsed time so they hold on hourly or 15-min grids.
  const gridX: number[] = [];
  if (winSpan > 0) {
    const startHour = Number(time[0].slice(11, 13));
    for (let h = 1; h < 24; h++) {
      if ((startHour + h) % 3 !== 0) continue;
      const gx = padX + ((h * 3600_000) / winSpan) * innerW;
      if (gx > padX && gx < padX + innerW) gridX.push(gx);
    }
  }

  const sky =
    sunrise && sunset && winSpan > 0
      ? ({
          "--sunrise": `${windowPct(sunrise, t0, winSpan).toFixed(2)}%`,
          "--sunset": `${windowPct(sunset, t0, winSpan).toFixed(2)}%`,
        } as CSSProperties)
      : null;

  return (
    <div className="temp-mini-wrap">
      {sky ? <div className="temp-mini__sky" style={sky} aria-hidden="true" /> : null}
      <svg
        className="temp-mini"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Temperature over the day (2 a.m. to 2 a.m.) with daylight shading"
      >
        {gridX.map((gx, i) => (
        <line key={`grid${i}`} className="temp-mini__grid" x1={gx} x2={gx} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
      ))}
      {feelsPast.map((s, i) => (
        <path key={`fp${i}`} className="temp-mini__feels" d={toPath(s)} fill="none" vectorEffect="non-scaling-stroke" />
      ))}
      {feelsFut.map((s, i) => (
        <path key={`ff${i}`} className="temp-mini__feels temp-mini__feels--forecast" d={toPath(s)} fill="none" vectorEffect="non-scaling-stroke" />
      ))}
      {future.length > 1 ? (
        <path className="temp-mini__line temp-mini__line--forecast" d={toPath(future)} fill="none" vectorEffect="non-scaling-stroke" />
      ) : null}
      {past.length > 1 ? (
        <path className="temp-mini__line" d={toPath(past)} fill="none" vectorEffect="non-scaling-stroke" />
      ) : null}
      {nowFrac > 0 ? (
        <line className="temp-mini__now" x1={nowX} x2={nowX} y1={0} y2={H} />
      ) : null}

      {hiI >= 0 ? (
        <g>
          <circle className="temp-mini__dot temp-mini__dot--hi" cx={x(hiI)} cy={y(temperature[hiI])} r={2.6} />
          <text className="temp-mini__lbl temp-mini__lbl--hi" x={clampX(x(hiI))} y={y(temperature[hiI]) - 5} textAnchor="middle">
            {formatTemp(temperature[hiI], units)}
          </text>
        </g>
      ) : null}
      {loI >= 0 ? (
        <g>
          <circle className="temp-mini__dot temp-mini__dot--lo" cx={x(loI)} cy={y(temperature[loI])} r={2.6} />
          <text className="temp-mini__lbl temp-mini__lbl--lo" x={clampX(x(loI))} y={y(temperature[loI]) + 11} textAnchor="middle">
            {formatTemp(temperature[loI], units)}
          </text>
        </g>
      ) : null}
      </svg>
    </div>
  );
}
