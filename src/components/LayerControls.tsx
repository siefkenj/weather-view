import {
  ALL_PANELS,
  ALL_SERIES,
  type DashboardState,
  type PanelKey,
  type SeriesKey,
  type ViewMode,
} from "../hooks/useUrlState";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import type { Units } from "../utils/units";

const SERIES_LABEL: Record<SeriesKey, string> = {
  temp: "Temp",
  feels: "Feels like",
  dew: "Dew point",
  wetbulb: "Wet bulb",
  enthalpy: "Enthalpy",
};
const PANEL_LABEL: Record<PanelKey, string> = {
  precip: "Precipitation",
  atmo: "Atmosphere",
  air: "Air quality",
};

interface Props {
  state: DashboardState;
  setView: (v: ViewMode) => void;
  setDays: (n: number) => void;
  toggleSeries: (k: SeriesKey) => void;
  togglePanel: (k: PanelKey) => void;
  setCi: (v: boolean) => void;
  setUnits: (u: Units) => void;
}

export function LayerControls({
  state,
  setView,
  setDays,
  toggleSeries,
  togglePanel,
  setCi,
  setUnits,
}: Props) {
  return (
    <div className="controls">
      <div className="controls__group segmented" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={state.view === "forecast"}
          className={"seg" + (state.view === "forecast" ? " seg--on" : "")}
          onClick={() => setView("forecast")}
        >
          Forecast
        </button>
        <button
          role="tab"
          aria-selected={state.view === "history"}
          className={"seg" + (state.view === "history" ? " seg--on" : "")}
          onClick={() => setView("history")}
        >
          History
        </button>
      </div>

      {state.view === "forecast" ? (
        <label className="controls__group days">
          <span className="controls__label">Days</span>
          <input
            type="range"
            min={1}
            max={MAX_FORECAST_DAYS}
            value={state.days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <span className="days__value">{state.days}</span>
        </label>
      ) : null}

      <div className="controls__group chips" role="group" aria-label="Series">
        {ALL_SERIES.map((k) => (
          <button
            key={k}
            className={"chip chip--" + k + (state.series.includes(k) ? " chip--on" : "")}
            aria-pressed={state.series.includes(k)}
            onClick={() => toggleSeries(k)}
          >
            {SERIES_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="controls__group chips" role="group" aria-label="Panels">
        {ALL_PANELS.map((k) => (
          <button
            key={k}
            className={"chip" + (state.panels.includes(k) ? " chip--on" : "")}
            aria-pressed={state.panels.includes(k)}
            onClick={() => togglePanel(k)}
          >
            {PANEL_LABEL[k]}
          </button>
        ))}
      </div>

      <label className="controls__group switch">
        <input type="checkbox" checked={state.ci} onChange={(e) => setCi(e.target.checked)} />
        <span>Confidence intervals</span>
      </label>

      <div className="controls__group segmented units" role="group" aria-label="Units">
        <button
          className={"seg" + (state.units === "metric" ? " seg--on" : "")}
          onClick={() => setUnits("metric")}
        >
          °C
        </button>
        <button
          className={"seg" + (state.units === "imperial" ? " seg--on" : "")}
          onClick={() => setUnits("imperial")}
        >
          °F
        </button>
      </div>
    </div>
  );
}
