import { useRef, useState } from "react";
import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatFullDate, formatMonthDay, formatTime, formatWeekday } from "../utils/format";
import { formatPrecip, formatTemp, type Units } from "../utils/units";
import type { DailySummary } from "../utils/series";

interface Props {
  summaries: DailySummary[];
  units: Units;
  todayKey?: string;
}

const CARD_HALF = 140; // half the popover width, for edge clamping

/**
 * Integrated chart header: each day shows its date with the weather icon below
 * it (no highs/lows inline). Hovering a day reveals the full forecast card.
 * The 56px side padding matches the ECharts grid inset so days line up with the
 * chart columns below.
 */
export function ForecastHeader({ summaries, units, todayKey }: Props) {
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  function open(i: number, target: HTMLElement) {
    const row = rowRef.current;
    if (!row) return;
    const cell = target.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const center = cell.left - rowRect.left + cell.width / 2;
    const left = Math.max(CARD_HALF + 4, Math.min(center, rowRect.width - CARD_HALF - 4));
    setHover({ i, left });
  }

  const active = hover ? summaries[hover.i] : null;
  const activeWx = active ? describeWeather(active.code) : null;

  return (
    <div className="forecast-header" ref={rowRef}>
      <div className="forecast-header__row">
        {summaries.map((d, i) => {
          const wx = describeWeather(d.code);
          const isToday = todayKey === d.date;
          return (
            <button
              key={d.date}
              type="button"
              className={
                "fh-cell" +
                (isToday ? " fh-cell--today" : "") +
                (hover?.i === i ? " fh-cell--active" : "")
              }
              onMouseEnter={(e) => open(i, e.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => open(i, e.currentTarget)}
              onBlur={() => setHover(null)}
              aria-label={`${formatFullDate(d.date)}: ${wx.label}`}
            >
              <span className="fh-date">
                <span className="fh-weekday">{isToday ? "Today" : formatWeekday(d.date)}</span>
                <span className="fh-md">{formatMonthDay(d.date)}</span>
              </span>
              <WeatherIcon kind={wx.icon} size={26} title={wx.label} />
              {d.precipSum > 0 ? <span className="fh-precip">{formatPrecip(d.precipSum)}</span> : null}
            </button>
          );
        })}
      </div>

      {active && activeWx ? (
        <div className="forecast-card" style={{ left: hover!.left }} role="tooltip">
          <div className="forecast-card__head">
            <WeatherIcon kind={activeWx.icon} size={46} title={activeWx.label} />
            <div>
              <div className="forecast-card__date">{formatFullDate(active.date)}</div>
              <div className="forecast-card__desc">{activeWx.label}</div>
            </div>
          </div>
          <div className="forecast-card__grid">
            <Fact k="High" v={formatTemp(active.tempMax, units)} />
            <Fact k="Low" v={formatTemp(active.tempMin, units)} />
            <Fact k="Chance" v={`${Math.round(active.precipProbMax ?? 0)}%`} />
            <Fact k="Precip" v={formatPrecip(active.precipSum)} />
            <Fact k="Rain hrs" v={`${Math.round(active.precipHours ?? 0)} h`} />
            <Fact k="UV max" v={String(Math.round(active.uvMax ?? 0))} />
            <Fact k="Sunrise" v={formatTime(active.sunrise)} />
            <Fact k="Sunset" v={formatTime(active.sunset)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="forecast-card__fact">
      <span className="fact-key">{k}</span>
      <span className="fact-val">{v}</span>
    </div>
  );
}
