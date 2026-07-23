import { useId } from "react";
import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatTemp, type Units } from "../utils/units";
import { dayKey, formatTime } from "../utils/format";
import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { daylightIntensity } from "../utils/solar";
import { isDaytime, type DailySummary } from "../utils/series";
import type { ForecastCurrent, Place } from "../api/types";
import { placeLabel } from "../utils/place";

interface Props {
  place: Place;
  current: ForecastCurrent;
  today?: DailySummary;
  units: Units;
  aqhi?: number | null;
  /** Hourly data across one 2am→2am weather day for the mini graph (°C). `dayKey`
   *  is the day the high/low markers belong to; sunrise/sunset drive the shading. */
  mini?: {
    time: string[];
    temperature: number[];
    apparent: number[];
    dayKey: string;
    sunrise?: string;
    sunset?: string;
  } | null;
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
                  apparent={mini!.apparent}
                  todayKey={mini!.dayKey}
                  sunrise={mini!.sunrise}
                  sunset={mini!.sunset}
                  latitude={place.latitude}
                  nowIso={current.time}
                  nowTemp={current.temperature_2m}
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
  apparent: number[];
  todayKey: string;
  sunrise?: string;
  sunset?: string;
  latitude: number;
  nowIso: string;
  nowTemp: number;
  units: Units;
}

// Light-intensity shading interpolated in CIELAB from a deep, cool night to a
// bright, warm midday. Lab keeps the brightness ramp perceptually even while the
// hue drifts blue→warm (like real daylight color temperature), which reads far
// nicer than flat grayscale. Endpoints: [L*, a*, b*].
const NIGHT_LAB = [26, 6, -26];
const DAY_LAB = [98, -4, 14];

function labToRgb(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f3 = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);
  // D65 reference white.
  const X = 0.95047 * f3(fx);
  const Y = 1.0 * f3(fy);
  const Z = 1.08883 * f3(fz);
  const lin = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
  const ch = lin.map((c) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  });
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function stopColor(intensity: number, peak: number): string {
  const t = peak > 0 ? Math.min(1, intensity / peak) : 0;
  return labToRgb(
    NIGHT_LAB[0] + (DAY_LAB[0] - NIGHT_LAB[0]) * t,
    NIGHT_LAB[1] + (DAY_LAB[1] - NIGHT_LAB[1]) * t,
    NIGHT_LAB[2] + (DAY_LAB[2] - NIGHT_LAB[2]) * t,
  );
}

/** Compact temperature trace over one 2am→2am day: solar-lit background, actual
 *  (solid) past vs forecast (faded) future, today's high/low, and — only where it
 *  diverges by >2°C — a dashed "feels like" line. */
function TempMiniGraph({
  time,
  temperature,
  apparent,
  todayKey,
  sunrise,
  sunset,
  latitude,
  nowIso,
  nowTemp,
  units,
}: MiniProps) {
  const gid = useId();
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
  // past is actual (solid), the future is forecast (faded).
  const nowH13 = nowIso.slice(0, 13);
  let k = -1;
  for (let i = 0; i < n; i++) if (time[i].slice(0, 13) <= nowH13) k = i;
  const nowFrac = k >= 0 ? Math.min(n - 1, k + Number(nowIso.slice(14, 16)) / 60) : 0;
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

  const intensity = daylightIntensity(time, sunrise, sunset, latitude);
  const peak = intensity ? Math.max(...intensity, 1e-6) : 1;

  return (
    <svg
      className="temp-mini"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Temperature over the day (2 a.m. to 2 a.m.) with daylight shading"
    >
      {intensity ? (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            {intensity.map((v, i) => (
              <stop key={i} offset={`${((i / (n - 1)) * 100).toFixed(2)}%`} stopColor={stopColor(v, peak)} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      {intensity ? <rect x={padX} y={0} width={innerW} height={H} fill={`url(#${gid})`} /> : null}

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
        <line className="temp-mini__now" x1={nowX} x2={nowX} y1={padTop - 6} y2={H - padBottom + 2} />
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
  );
}
