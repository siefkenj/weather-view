import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatTemp, type Units } from "../utils/units";
import { formatTime } from "../utils/format";
import { isDaytime, type DailySummary } from "../utils/series";
import type { ForecastCurrent, Place } from "../api/types";
import { placeLabel } from "../utils/place";

interface Props {
  place: Place;
  current: ForecastCurrent;
  today?: DailySummary;
  units: Units;
}

export function CurrentConditions({ place, current, today, units }: Props) {
  const wx = describeWeather(current.weather_code);
  const day = isDaytime(current.time, today?.sunrise, today?.sunset);

  return (
    <section className="current" aria-label="Current conditions">
      <div className="current__main">
        <WeatherIcon kind={wx.icon} night={!day} size={84} title={wx.label} />
        <div className="current__temp-block">
          <div className="current__temp">{formatTemp(current.temperature_2m, units, 0)}</div>
          <div className="current__label">{wx.label}</div>
          <div className="current__feels">Feels like {formatTemp(current.apparent_temperature, units, 0)}</div>
        </div>
      </div>
      <div className="current__meta">
        <div className="current__place">{placeLabel(place)}</div>
        {today ? (
          <ul className="current__facts">
            <li>
              <span className="fact-key">High</span>
              <span className="fact-val">{formatTemp(today.tempMax, units)}</span>
            </li>
            <li>
              <span className="fact-key">Low</span>
              <span className="fact-val">{formatTemp(today.tempMin, units)}</span>
            </li>
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
