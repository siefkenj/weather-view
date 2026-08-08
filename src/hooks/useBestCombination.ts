// Drives the "find best combination" button: on demand, downloads ~90 days of per-model
// forecast history + observed truth for a place, then ranks model combinations by rain
// timing in-browser (see utils/modelEval, api/modelHistory). One run at a time; a new
// run or unmount aborts the previous fetches.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModelPrecipHistory, fetchTruthPrecip } from "../api/modelHistory";
import { rankCombinations, wetHours, type Combination } from "../utils/modelEval";
import { addDays, todayInZone } from "../utils/format";
import type { Place } from "../api/types";

/** How much history to download and test over. */
export const HISTORY_DAYS = 90;

export type BestComboStatus = "idle" | "loading" | "done" | "error";

export interface BestComboResult {
  source: "gauge" | "reanalysis";
  /** Label for the truth used, e.g. "Toronto City gauge · 4 km" or "ERA5 reanalysis". */
  truthLabel: string;
  /** Ranked combinations (best rain-timing first); empty if there was too little rain. */
  combos: Combination[];
  /** Observed rain hours in the window (context for the panel). */
  rainHours: number;
  /** Models that had data at the point (the search space). */
  modelCount: number;
}

export function useBestCombination() {
  const [status, setStatus] = useState<BestComboStatus>("idle");
  const [result, setResult] = useState<BestComboResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const run = useCallback(async (place: Place): Promise<BestComboResult | null> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      // End yesterday: the ERA5 archive (and gauges) lag, and its allowed end_date can
      // sit a day behind "today" for zones ahead of UTC — requesting today 400s there.
      const end = addDays(todayInZone(place.timezone), -1);
      const start = addDays(end, -HISTORY_DAYS);
      // Truth first — it fixes the point (a Canadian gauge, else the location) the model
      // history is sampled at, so model and truth are spatially coincident.
      const truth = await fetchTruthPrecip(place, start, end, ac.signal);
      const hist = await fetchModelPrecipHistory(truth.point, start, end, ac.signal);
      if (ac.signal.aborted) return null;
      const res: BestComboResult = {
        source: truth.source,
        truthLabel: truth.label,
        combos: rankCombinations(hist.byModel, truth.precip, hist.models),
        rainHours: wetHours(truth.precip).length,
        modelCount: hist.models.length,
      };
      setResult(res);
      setStatus("done");
      return res;
    } catch (e) {
      if (ac.signal.aborted) return null;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return null;
    }
  }, []);

  return { status, result, error, run, reset };
}
