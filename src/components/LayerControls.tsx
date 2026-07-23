import { type DashboardState } from "../hooks/useUrlState";
import { MAX_FORECAST_DAYS } from "../api/openMeteo";
import type { Units } from "../utils/units";

interface Props {
  state: DashboardState;
  setDays: (n: number) => void;
  setCi: (v: boolean) => void;
  setUnits: (u: Units) => void;
}

// Series and panel visibility now live in the chart legend (each entry carries its
// own description on hover), so this menu keeps only the window/CI/unit controls.
export function LayerControls({ state, setDays, setCi, setUnits }: Props) {
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
