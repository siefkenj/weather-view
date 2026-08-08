// Weather-model selector for the settings menu. A two-way toggle chooses between
// "Automatic" (Open-Meteo's `best_match`) and "Specific model". In specific mode a
// checklist appears; picking two or more blends them into a consensus forecast (see
// utils/consensus). The selection lives in the dashboard view state (`extraModels`)
// and is shared via the URL, so a chosen model/blend is linkable.
//
// In specific mode a "Find best combination" button downloads ~90 days of forecast
// history + observed rain for the current place, tests every model blend in-browser
// (hooks/useBestCombination), and checks the optimal set — a ready-made consensus.

import { useState } from "react";
import { MODELS, MODEL_IDS, modelLabel } from "../utils/models";
import { useBestCombination, HISTORY_DAYS } from "../hooks/useBestCombination";
import type { Place } from "../api/types";

interface Props {
  selected: string[];
  onChange: (models: string[]) => void;
  place?: Place;
}

export function ModelPicker({ selected, onChange, place }: Props) {
  // Ignore any stale/unknown ids that rode in on the URL when counting/echoing.
  const chosen = selected.filter((id) => MODEL_IDS.has(id));
  const count = chosen.length;

  // "Specific model" is active whenever a model is checked; it also latches on when
  // the user explicitly picks that mode but hasn't chosen a model yet (empty list).
  // Any live selection (e.g. one arriving via the URL) forces it on regardless.
  const [wantSpecific, setWantSpecific] = useState(count > 0);
  const specific = wantSpecific || count > 0;

  const best = useBestCombination();

  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((m) => m !== id) : [...chosen, id];
    onChange(next);
  };

  const chooseAuto = () => {
    setWantSpecific(false);
    best.reset();
    onChange([]);
  };

  const specificSub =
    count === 0
      ? "Pick one or more models below."
      : count === 1
        ? "Showing a single model."
        : `Consensus — blending ${count} models (median of each value; rain when most agree).`;

  return (
    <div className="model-picker">
      <div className="mode-toggle" role="group" aria-label="Model selection">
        <button
          type="button"
          className={`mode-toggle__opt${specific ? "" : " is-active"}`}
          aria-pressed={!specific}
          onClick={chooseAuto}
        >
          <span className="mode-toggle__name">Automatic</span>
          <span className="mode-toggle__sub">Best model for each location</span>
        </button>
        <button
          type="button"
          className={`mode-toggle__opt${specific ? " is-active" : ""}`}
          aria-pressed={specific}
          onClick={() => setWantSpecific(true)}
        >
          <span className="mode-toggle__name">Specific model</span>
          <span className="mode-toggle__sub">{specificSub}</span>
        </button>
      </div>

      {specific ? (
        <>
          <ul className="model-picker__list">
            {MODELS.map((m) => {
              const on = chosen.includes(m.id);
              return (
                <li key={m.id}>
                  <label className="model-opt" title={`${m.agency} · ${m.region}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                    <span className="model-opt__text">
                      <span className="model-opt__name">{m.label}</span>
                      <span className="model-opt__sub">{m.region}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {place ? <BestFinder place={place} best={best} onApply={onChange} /> : null}
        </>
      ) : null}
    </div>
  );
}

function BestFinder({
  place,
  best,
  onApply,
}: {
  place: Place;
  best: ReturnType<typeof useBestCombination>;
  onApply: (models: string[]) => void;
}) {
  const { status, result, error, run } = best;

  const find = async () => {
    const res = await run(place);
    // The end result: check the optimal set of models (a ready-made consensus).
    if (res && res.combos.length > 0) onApply(res.combos[0].models);
  };

  const timedOut = !!error && /\b(504|502|503|gateway|timeout|timed out)\b/i.test(error);

  return (
    <div className="best-finder">
      <button
        type="button"
        className="btn btn--sm best-finder__go"
        onClick={find}
        disabled={status === "loading"}
        title={`Download ${HISTORY_DAYS} days of forecasts and observed rain for ${place.name} and check the model blend that times rain best.`}
      >
        {status === "loading" ? (
          <>
            <span className="spinner" aria-hidden="true" /> Testing combinations…
          </>
        ) : (
          `Find best combination for ${place.name}`
        )}
      </button>

      {status === "error" ? (
        <p className="best-finder__err">
          {timedOut
            ? "The weather server timed out (90-day downloads can be slow). Press the button to try again."
            : `Couldn’t run the test: ${error}`}
        </p>
      ) : null}

      {status === "done" && result ? (
        result.combos.length === 0 ? (
          <p className="settings__hint">
            Not enough rain near {place.name} in the last {HISTORY_DAYS} days to choose ({result.rainHours} rain hours).
          </p>
        ) : (
          <p className="best-finder__caption">
            Checked <strong>{result.combos[0].models.map(modelLabel).join(" + ")}</strong> — best rain timing vs{" "}
            {result.truthLabel} ({result.combos[0].jitter.toFixed(1)} h, {Math.round(result.combos[0].caught * 100)}%
            caught)
            {result.source === "reanalysis" ? (
              <span className="best-finder__note"> · reanalysis estimate, not a real gauge</span>
            ) : null}
          </p>
        )
      ) : null}
    </div>
  );
}
