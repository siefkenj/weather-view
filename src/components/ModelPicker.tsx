// Weather-model selector for the settings menu. A two-way toggle chooses between
// "Automatic" (Open-Meteo's `best_match`) and "Specific model". In specific mode a
// checklist appears; picking two or more blends them into a consensus forecast (see
// utils/consensus). The selection lives in the dashboard view state (`extraModels`)
// and is shared via the URL, so a chosen model/blend is linkable.

import { useState } from "react";
import { MODELS, MODEL_IDS } from "../utils/models";

interface Props {
  selected: string[];
  onChange: (models: string[]) => void;
}

export function ModelPicker({ selected, onChange }: Props) {
  // Ignore any stale/unknown ids that rode in on the URL when counting/echoing.
  const chosen = selected.filter((id) => MODEL_IDS.has(id));
  const count = chosen.length;

  // "Specific model" is active whenever a model is checked; it also latches on when
  // the user explicitly picks that mode but hasn't chosen a model yet (empty list).
  // Any live selection (e.g. one arriving via the URL) forces it on regardless.
  const [wantSpecific, setWantSpecific] = useState(count > 0);
  const specific = wantSpecific || count > 0;

  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((m) => m !== id) : [...chosen, id];
    onChange(next);
  };

  const chooseAuto = () => {
    setWantSpecific(false);
    onChange([]);
  };

  // The "specific model" description, which carries the consensus note when relevant.
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
      ) : null}
    </div>
  );
}
