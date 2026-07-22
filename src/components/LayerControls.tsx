import {
  ALL_PANELS,
  ALL_SERIES,
  type DashboardState,
  type PanelKey,
  type SeriesKey,
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
// Hover explanations for each togglable series.
const SERIES_HELP: Record<SeriesKey, string> = {
  temp: "Air temperature measured 2 m above the ground.",
  feels: "Feels-like (apparent) temperature — folds in humidity, wind, and sun.",
  dew: "Dew point — the temperature at which dew forms; higher feels muggier.",
  wetbulb:
    "Wet-bulb temperature — the coolest a surface can get by evaporation. Sustained values near 35 °C are life-threatening even in the shade.",
  enthalpy:
    "Enthalpy — total heat energy of the moist air (kJ/kg), combining temperature and humidity.",
};
const PANEL_LABEL: Record<PanelKey, string> = {
  precip: "Precipitation",
  atmo: "Atmosphere",
  air: "Air quality",
};
const PANEL_HELP: Record<PanelKey, string> = {
  precip: "Precipitation panel — hourly rain/snow amount and chance of precipitation.",
  atmo: "Atmosphere panel — cloud cover, relative humidity, and surface pressure.",
  air: "Air-quality panel — US AQI plus PM2.5, PM10, ozone, and NO₂.",
};

interface Props {
  state: DashboardState;
  setDays: (n: number) => void;
  toggleSeries: (k: SeriesKey) => void;
  togglePanel: (k: PanelKey) => void;
  setCi: (v: boolean) => void;
  setUnits: (u: Units) => void;
}

export function LayerControls({
  state,
  setDays,
  toggleSeries,
  togglePanel,
  setCi,
  setUnits,
}: Props) {
  return (
    <div className="controls">
      <label
        className="controls__group days"
        title="How many days of the timeline are visible at once."
      >
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

      <div className="controls__group chips" role="group" aria-label="Series">
        {ALL_SERIES.map((k) => (
          <button
            key={k}
            className={"chip chip--" + k + (state.series.includes(k) ? " chip--on" : "")}
            aria-pressed={state.series.includes(k)}
            title={SERIES_HELP[k]}
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
            title={PANEL_HELP[k]}
            onClick={() => togglePanel(k)}
          >
            {PANEL_LABEL[k]}
          </button>
        ))}
      </div>

      <label
        className="controls__group switch"
        title="Confidence intervals — a shaded 10–90% ensemble envelope (ECMWF IFS, 51 members) around the temperature and precipitation lines."
      >
        <input type="checkbox" checked={state.ci} onChange={(e) => setCi(e.target.checked)} />
        <span>Confidence intervals</span>
      </label>

      <div className="controls__group segmented units" role="group" aria-label="Units">
        <button
          className={"seg" + (state.units === "metric" ? " seg--on" : "")}
          title="Show temperatures in Celsius."
          onClick={() => setUnits("metric")}
        >
          °C
        </button>
        <button
          className={"seg" + (state.units === "imperial" ? " seg--on" : "")}
          title="Show temperatures in Fahrenheit."
          onClick={() => setUnits("imperial")}
        >
          °F
        </button>
      </div>
    </div>
  );
}
