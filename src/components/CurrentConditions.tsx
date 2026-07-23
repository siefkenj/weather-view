import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatTemp, type Units } from "../utils/units";
import { dayKey, formatTime } from "../utils/format";
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
  const hasMini = mini && mini.time.length > 1;

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
        {today ? (
          <ul className="current__facts">
            {hasMini ? (
              <li className="fact fact--graph">
                <span className="fact-key">High / Low</span>
                <TempMiniGraph
                  time={mini!.time}
                  temperature={mini!.temperature}
                  todayKey={dayKey(current.time)}
                  nowIso={current.time}
                  units={units}
                />
              </li>
            ) : null}
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

/** Compact temperature trace (2am yesterday → 2am tomorrow) with today's high/low marked. */
function TempMiniGraph({ time, temperature, todayKey, nowIso, units }: MiniProps) {
  const n = time.length;
  const finite = temperature.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
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
    if (v > hi) { hi = v; hiI = i; }
    if (v < lo) { lo = v; loI = i; }
  }

  const nowTarget = nowIso.slice(0, 13);
  let nowI = -1;
  for (let i = 0; i < n; i++) {
    if (time[i].slice(0, 13) === nowTarget) { nowI = i; break; }
  }

  return (
    <svg
      className="temp-mini"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Temperature from 2 a.m. yesterday to 2 a.m. tomorrow"
    >
      {nowI >= 0 ? (
        <line className="temp-mini__now" x1={x(nowI)} x2={x(nowI)} y1={padTop - 6} y2={H - padBottom + 2} />
      ) : null}
      <path className="temp-mini__line" d={path} fill="none" vectorEffect="non-scaling-stroke" />
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
  );
}
