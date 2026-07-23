import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatTemp, type Units } from "../utils/units";
import { dayKey, formatTime, formatWeekday } from "../utils/format";
import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { isDaytime, type DailySummary } from "../utils/series";
import type { ForecastCurrent, Place } from "../api/types";
import { placeLabel } from "../utils/place";

interface Props {
  place: Place;
  current: ForecastCurrent;
  today?: DailySummary;
  units: Units;
  aqhi?: number | null;
  /** Hourly temperature spanning 2am yesterday → 2am tomorrow, for the mini graph. */
  mini?: { time: string[]; temperature: number[] } | null;
}

export function CurrentConditions({ place, current, today, units, aqhi, mini }: Props) {
  const wx = describeWeather(current.weather_code);
  const day = isDaytime(current.time, today?.sunrise, today?.sunset);
  const cat = aqhi != null && Number.isFinite(aqhi) ? aqhiCategory(aqhi) : null;

  return (
    <section className="current" aria-label="Current conditions">
      <div className="current__main">
        <WeatherIcon kind={wx.icon} night={!day} size={84} title={wx.label} />
        <div className="current__temp-block">
          <div className="current__temp">{formatTemp(current.temperature_2m, units, 0)}</div>
          <div className="current__label">{wx.label}</div>
          <div className="current__feels">Feels like {formatTemp(current.apparent_temperature, units, 0)}</div>
          {cat ? (
            <div className="current__aqhi" title={cat.message}>
              <span className="aqi-chip" style={{ background: cat.color }}>{cat.label}</span>
              <span className="current__aqhi-val">AQHI {formatAqhi(aqhi)}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="current__meta">
        <div className="current__place">{placeLabel(place)}</div>
        {mini && mini.time.length > 1 ? (
          <TempMiniGraph
            time={mini.time}
            temperature={mini.temperature}
            todayKey={dayKey(current.time)}
            nowIso={current.time}
            units={units}
          />
        ) : null}
        {today ? (
          <ul className="current__facts">
            <li>
              <span className="fact-key">UV max</span>
              <span className="fact-val">{Math.round(today.uvMax ?? 0)}</span>
            </li>
            <li>
              <span className="fact-key">Sunrise</span>
              <span className="fact-val">{formatTime(today.sunrise)}</span>
            </li>
            <li>
              <span className="fact-key">Sunset</span>
              <span className="fact-val">{formatTime(today.sunset)}</span>
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}

interface MiniProps {
  time: string[];
  temperature: number[];
  todayKey: string;
  nowIso: string;
  units: Units;
}

/** Small temperature trace (2am yesterday → 2am tomorrow) with today's high/low marked. */
function TempMiniGraph({ time, temperature, todayKey, nowIso, units }: MiniProps) {
  const n = time.length;
  const finite = temperature.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;

  const W = 340;
  const H = 104;
  const padX = 10;
  const padTop = 20;
  const padBottom = 18;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const x = (i: number) => padX + (i / (n - 1)) * innerW;
  const y = (v: number) => padTop + (1 - (v - min) / span) * innerH;
  const clampX = (px: number) => Math.max(padX + 14, Math.min(px, W - padX - 14));

  const path = temperature
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  // Today's high & low (restricted to today's hours so adjacent days don't win).
  let hiI = -1;
  let loI = -1;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < n; i++) {
    if (dayKey(time[i]) !== todayKey) continue;
    const v = temperature[i];
    if (!Number.isFinite(v)) continue;
    if (v > hi) {
      hi = v;
      hiI = i;
    }
    if (v < lo) {
      lo = v;
      loI = i;
    }
  }

  const nowTarget = nowIso.slice(0, 13);
  let nowI = -1;
  for (let i = 0; i < n; i++) {
    if (time[i].slice(0, 13) === nowTarget) {
      nowI = i;
      break;
    }
  }

  // Day boundaries → light dividers; labels centered in each day's segment.
  const bounds: number[] = [];
  for (let i = 1; i < n; i++) if (dayKey(time[i]) !== dayKey(time[i - 1])) bounds.push(i);
  const segEdges = [0, ...bounds, n];
  const segments = segEdges.slice(0, -1).map((a, k) => ({ a, b: segEdges[k + 1] }));

  return (
    <svg
      className="temp-mini"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Temperature from 2 a.m. yesterday to 2 a.m. tomorrow"
    >
      {bounds.map((i, k) => (
        <line key={k} className="temp-mini__divider" x1={x(i)} x2={x(i)} y1={padTop - 8} y2={H - padBottom} />
      ))}
      {segments.map((s, k) => (
        <text key={k} className="temp-mini__day" x={x((s.a + s.b - 1) / 2)} y={H - 4} textAnchor="middle">
          {dayKey(time[s.a]) === todayKey ? "Today" : formatWeekday(time[s.a])}
        </text>
      ))}
      <path className="temp-mini__line" d={path} fill="none" vectorEffect="non-scaling-stroke" />
      {nowI >= 0 ? (
        <line className="temp-mini__now" x1={x(nowI)} x2={x(nowI)} y1={padTop - 8} y2={H - padBottom} />
      ) : null}
      {hiI >= 0 ? (
        <g>
          <circle className="temp-mini__dot temp-mini__dot--hi" cx={x(hiI)} cy={y(temperature[hiI])} r={3.2} />
          <text className="temp-mini__lbl temp-mini__lbl--hi" x={clampX(x(hiI))} y={y(temperature[hiI]) - 7} textAnchor="middle">
            {formatTemp(temperature[hiI], units)}
          </text>
        </g>
      ) : null}
      {loI >= 0 ? (
        <g>
          <circle className="temp-mini__dot temp-mini__dot--lo" cx={x(loI)} cy={y(temperature[loI])} r={3.2} />
          <text className="temp-mini__lbl temp-mini__lbl--lo" x={clampX(x(loI))} y={y(temperature[loI]) + 14} textAnchor="middle">
            {formatTemp(temperature[loI], units)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
