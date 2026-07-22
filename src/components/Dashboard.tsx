import { useMemo, useState } from "react";
import { CurrentConditions } from "./CurrentConditions";
import { DailyStrip } from "./DailyStrip";
import { LayerControls } from "./LayerControls";
import { Meteogram } from "./Meteogram";
import { AirQualityPanel } from "./AirQualityPanel";
import { useDashboardState } from "../hooks/useUrlState";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useAirQuality, useEnsemble, useForecast } from "../hooks/useWeather";
import { MAX_PAST_DAYS } from "../api/openMeteo";
import { computeBands, recenterBandOnLine, type Bands } from "../api/ensemble";
import {
  dailySummaries,
  dayWindow,
  forecastWindow,
  type HourlyPoint,
} from "../utils/series";
import { dayKey, formatFullDate } from "../utils/format";
import type { Place } from "../api/types";

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
  const isHistory = state.view === "history";
  const isNarrow = useMediaQuery("(max-width: 640px)");
  const portrait = useMediaQuery("(max-width: 640px) and (orientation: portrait)");
  const [optionsOpen, setOptionsOpen] = useState(!isNarrow);

  const forecastDays = state.days;
  const pastDays = isHistory ? MAX_PAST_DAYS : 1;

  const forecastQ = useForecast(place, { forecastDays, pastDays });
  const ciEnabled = state.ci && !isHistory;
  const ensembleQ = useEnsemble(place, { forecastDays, enabled: ciEnabled });
  const airEnabled = state.panels.includes("air");
  const airQ = useAirQuality(place, {
    forecastDays: Math.min(forecastDays, 7),
    pastDays: isHistory ? MAX_PAST_DAYS : 1,
    enabled: airEnabled,
  });

  const forecast = forecastQ.data;

  const summaries = useMemo(() => (forecast ? dailySummaries(forecast) : []), [forecast]);
  const todayKey = forecast ? dayKey(forecast.current.time) : "";

  const historyDays = useMemo(
    () => summaries.filter((s) => s.date < todayKey),
    [summaries, todayKey],
  );
  const forecastDaysList = useMemo(
    () => summaries.filter((s) => s.date >= todayKey).slice(0, forecastDays),
    [summaries, todayKey, forecastDays],
  );

  const selectedDate =
    state.date ?? (historyDays.length ? historyDays[historyDays.length - 1].date : null);

  const hourly: HourlyPoint | null = useMemo(() => {
    if (!forecast) return null;
    if (isHistory) {
      return selectedDate ? dayWindow(forecast, selectedDate) : null;
    }
    return forecastWindow(forecast, forecastDays);
  }, [forecast, isHistory, selectedDate, forecastDays]);

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
  const hasHourly = !!hourly && hourly.time.length > 0;
  // Wide screens draw the day/date + icon on the temperature graph (hover a day
  // for the full card). Narrow screens keep the standalone scrollable strip.
  const integrated = !isNarrow;
  const emptyState = <div className="state state--empty">No data for this day.</div>;

  return (
    <div className="dashboard">
      <CurrentConditions place={place} current={forecast.current} today={today} units={state.units} />

      {isHistory ? (
        <>
          <p className="section-title">
            {selectedDate ? `Recorded weather · ${formatFullDate(selectedDate)}` : "Pick a day"}
          </p>
          <DailyStrip
            summaries={historyDays}
            units={state.units}
            selectedDate={selectedDate}
            onSelect={(d) => controls.setDate(d)}
          />
          <div className="panel meteogram-panel">
            {hasHourly ? (
              <Meteogram
                hourly={hourly!}
                units={state.units}
                series={state.series}
                panels={state.panels}
                nowIso={null}
                vertical={portrait}
              />
            ) : (
              emptyState
            )}
          </div>
        </>
      ) : (
        <div className="panel meteogram-panel meteogram-panel--forecast">
          {!integrated ? (
            <DailyStrip summaries={forecastDaysList} units={state.units} todayKey={todayKey} />
          ) : null}
          {hasHourly ? (
            <Meteogram
              hourly={hourly!}
              units={state.units}
              series={state.series}
              panels={state.panels}
              tempBand={tempBand}
              precipBand={precipBand}
              nowIso={forecast.current.time}
              vertical={portrait}
              daily={integrated ? forecastDaysList : undefined}
              todayKey={todayKey}
            />
          ) : (
            emptyState
          )}
          {ciEnabled ? (
            <p className="ci-note">
              Shaded bands show the 10–90% ensemble range (ECMWF IFS){" "}
              {ensembleQ.isFetching ? "· loading…" : ""}
            </p>
          ) : null}
        </div>
      )}

      <section className="options">
        <button
          type="button"
          className="options__toggle"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((o) => !o)}
        >
          <span>Options</span>
          <span className="options__chevron" aria-hidden="true">
            {optionsOpen ? "▾" : "▸"}
          </span>
        </button>
        {optionsOpen ? (
          <LayerControls
            state={state}
            setView={controls.setView}
            setDays={controls.setDays}
            toggleSeries={controls.toggleSeries}
            togglePanel={controls.togglePanel}
            setCi={controls.setCi}
            setUnits={controls.setUnits}
          />
        ) : null}
      </section>

      {airEnabled ? (
        airQ.data ? (
          <AirQualityPanel
            data={airQ.data}
            nowIso={isHistory && selectedDate ? `${selectedDate}T12:00` : forecast.current.time}
          />
        ) : airQ.isLoading ? (
          <div className="state state--loading">Loading air quality…</div>
        ) : null
      ) : null}
    </div>
  );
}
