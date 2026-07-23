import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatMonthDay, formatWeekday } from "../utils/format";
import { formatPrecip, formatTemp, type Units } from "../utils/units";
import type { DailySummary } from "../utils/series";

interface Props {
  summaries: DailySummary[];
  units: Units;
  selectedDate?: string | null;
  todayKey?: string;
  onSelect?: (date: string) => void;
}

export function DailyStrip({ summaries, units, selectedDate, todayKey, onSelect }: Props) {
  return (
    <div className="daily-strip" role="list">
      {summaries.map((d) => {
        const wx = describeWeather(d.code);
        const isSelected = selectedDate === d.date;
        const isToday = todayKey === d.date;
        const interactive = Boolean(onSelect);
        return (
          <button
            key={d.date}
            type="button"
            role="listitem"
            className={
              "day-card" +
              (isSelected ? " day-card--selected" : "") +
              (isToday ? " day-card--today" : "") +
              (interactive ? " day-card--interactive" : "")
            }
            onClick={onSelect ? () => onSelect(d.date) : undefined}
            disabled={!interactive}
            title={wx.label}
          >
            <div className="day-card__date">
              <span className="day-card__weekday">{isToday ? "Today" : formatWeekday(d.date)}</span>
              <span className="day-card__md">{formatMonthDay(d.date)}</span>
            </div>
            <WeatherIcon kind={wx.icon} size={42} title={wx.label} className="wx-chip" />
            <div className="day-card__temps">
              <span className="temp-hi">{formatTemp(d.tempMax, units)}</span>
              <span className="temp-lo">{formatTemp(d.tempMin, units)}</span>
            </div>
            <div className="day-card__precip">
              <span className="precip-prob">{Math.round(d.precipProbMax ?? 0)}%</span>
              <span className="precip-amt">{formatPrecip(d.precipSum)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
