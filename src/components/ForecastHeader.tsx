import { useRef } from "react";
import { describeWeather } from "../api/weatherCode";
import { WeatherIcon } from "./WeatherIcon";
import { formatFullDate, formatMonthDay, formatWeekday, parseLocal } from "../utils/format";
import { formatPrecip, formatTemp, roundOrDash, type Units } from "../utils/units";
import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { aqiColor, type AirMode } from "../api/airQualityGrid";
import { useAppDispatch, useAppSelector } from "../store";
import { closeDay, openDay } from "../store/readoutSlice";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { DailySummary } from "../utils/series";

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Formatted value + colour for a day's peak air-quality reading, per index. */
function airFact(value: number | null | undefined, index: AirMode): { text: string; color?: string } {
  if (value == null || !Number.isFinite(value)) return { text: "–" };
  return index === "aqi"
    ? { text: String(Math.round(value)), color: rgb(aqiColor(value)) }
    : { text: formatAqhi(value), color: aqhiCategory(value).color };
}

interface Props {
  summaries: DailySummary[];
  units: Units;
  todayKey?: string;
  /** First/last timestamps of the visible window (chart x-axis extent), so each
   *  day tile can be positioned at its actual column — and slide with the chart
   *  when the window is panned by a fraction of a day. */
  windowStart: string;
  windowEnd: string;
  /** Peak air-quality value per day (YYYY-MM-DD → value) for the day popup. */
  dailyAir?: Map<string, number>;
  /** Which air index `dailyAir` holds. */
  airIndex?: AirMode;
}

const CARD_HALF = 140; // half the popover width, for edge clamping
const DAY_MS = 86_400_000;

/**
 * Integrated chart header: each day shows its date with the weather icon below
 * it (no highs/lows inline). Hovering a day reveals the full forecast card.
 * The 56px side padding matches the ECharts grid inset so days line up with the
 * chart columns below.
 */
export function ForecastHeader({
  summaries,
  units,
  todayKey,
  windowStart,
  windowEnd,
  dailyAir,
  airIndex = "aqhi",
}: Props) {
  // The open readout lives in the store so it's mutually exclusive with the chart's
  // hover tooltip — opening one closes the other (see store/readoutSlice.ts).
  const readout = useAppSelector((s) => s.readout);
  const dispatch = useAppDispatch();
  const rowRef = useRef<HTMLDivElement>(null);
  // On hover-capable devices the card follows the pointer (hover/focus open, leave/blur
  // close). On touch there's no hover, so a tap TOGGLES the card via onClick instead —
  // and we must NOT also open on the tap's synthetic mouseenter/focus, or the same tap
  // that opens would immediately close it. So the hover/focus openers are gated here.
  //
  // The onClick toggle is gated the same way, and must stay that way: unguarded, a mouse
  // click on an already-hovered tile lands on `toggle` while the card is open and closes
  // it, with the pointer still inside — so no fresh mouseenter fires and the card stays
  // shut until you leave and come back. It breaks hybrid touch+hover laptops too, where
  // `(hover: hover)` matches: tap → synthetic mouseenter opens → click closes.
  const canHover = useMediaQuery("(hover: hover)");

  const toggle = (date: string, target: HTMLElement) => {
    if (readout.kind === "day" && readout.date === date) dispatch(closeDay());
    else open(date, target);
  };

  // Map a day's noon onto the plot in the same linear way the chart's category axis
  // does (first sample at the left inset, last at the right), so tiles track the
  // columns exactly — including at fractional pan offsets.
  const t0 = parseLocal(windowStart).getTime();
  const t1 = parseLocal(windowEnd).getTime();
  const span = t1 - t0 || 1;
  const spanDays = Math.max(1, span / DAY_MS);
  // The row is inset to the plot region (56px gutters), so positions are relative to
  // the plot: frac 0 → left edge, frac 1 → right edge.
  const cellStyle = (date: string): React.CSSProperties => {
    const frac = (parseLocal(`${date}T12:00`).getTime() - t0) / span;
    return {
      // position: relative comes from .fh-cell — the tile stays in grid flow so it
      // contributes to the shared (tallest-tile) row height; left offsets it visually.
      left: `calc(${frac} * 100%)`,
      width: `calc(100% / ${spanDays} - 4px)`,
    };
  };

  function open(date: string, target: HTMLElement) {
    const row = rowRef.current;
    if (!row) return;
    const cell = target.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const center = cell.left - rowRect.left + cell.width / 2;
    const left = Math.max(CARD_HALF + 4, Math.min(center, rowRect.width - CARD_HALF - 4));
    dispatch(openDay({ date, left }));
  }

  const active =
    readout.kind === "day" ? summaries.find((s) => s.date === readout.date) ?? null : null;
  const activeWx = active ? describeWeather(active.code) : null;
  const activeAir = airFact(active ? dailyAir?.get(active.date) : undefined, airIndex);

  return (
    <div className="forecast-header" ref={rowRef}>
      <div className="forecast-header__row">
        {summaries.map((d) => {
          const wx = describeWeather(d.code);
          const isToday = todayKey === d.date;
          return (
            <button
              key={d.date}
              type="button"
              className={
                "fh-cell" +
                (isToday ? " fh-cell--today" : "") +
                (readout.kind === "day" && readout.date === d.date ? " fh-cell--active" : "")
              }
              style={cellStyle(d.date)}
              onMouseEnter={canHover ? (e) => open(d.date, e.currentTarget) : undefined}
              onMouseLeave={canHover ? () => dispatch(closeDay()) : undefined}
              onFocus={canHover ? (e) => open(d.date, e.currentTarget) : undefined}
              onBlur={canHover ? () => dispatch(closeDay()) : undefined}
              onClick={canHover ? undefined : (e) => toggle(d.date, e.currentTarget)}
              aria-label={`${formatFullDate(d.date)}: ${wx.label}`}
            >
              <span className="fh-date">
                <span className="fh-weekday">{isToday ? "Today" : formatWeekday(d.date)}</span>
                <span className="fh-md">{formatMonthDay(d.date)}</span>
              </span>
              <WeatherIcon kind={wx.icon} size={26} title={wx.label} />
              {d.precipSum > 0 ? (
                <span className="fh-precip">
                  {formatPrecip(d.precipSum)}
                  {Math.round(d.precipProbMax ?? 0) > 0 ? ` (${Math.round(d.precipProbMax)}%)` : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {readout.kind === "day" && active && activeWx ? (
        <div className="forecast-card" style={{ left: readout.left }} role="tooltip">
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
            <Fact k="Chance" v={roundOrDash(active.precipProbMax, "%")} />
            <Fact k="Precip" v={formatPrecip(active.precipSum)} />
            <Fact k="UV max" v={roundOrDash(active.uvMax)} />
            <Fact k={airIndex === "aqi" ? "AQI" : "AQHI"} v={activeAir.text} color={activeAir.color} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="forecast-card__fact">
      <span className="fact-key">{k}</span>
      <span className="fact-val" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}
