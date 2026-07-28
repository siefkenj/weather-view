// A minimal network-status indicator that lives in the reserved slot at the top-left
// of the current-conditions banner (see .status-slot). It's deliberately quiet: a
// small coloured dot + short dim text, showing only the single highest-priority
// state. The slot keeps a fixed footprint so nothing shifts when a message appears.
//
//   • rate-limited (HTTP 429) — "Rate-limited · showing saved data" (why data is stale)
//   • failed                  — "Couldn’t update <query>"
//   • loading (debounced)     — a tiny spinner + "Updating…"
//
// Full detail (which queries, the exact reason) is in the hover title, so the visible
// line stays short. Nothing is shown when the app is idle and healthy.

import { useEffect, useState, type ReactNode } from "react";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { clearStatusErrors } from "../status/statusStore";

const uniq = (xs: string[]): string[] => [...new Set(xs)];

export function StatusBar() {
  const { active, errors } = useNetworkStatus();
  const loading = active.length > 0;

  // Debounce the "updating" state so fast fetches / cache hits don't flicker it.
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const t = setTimeout(() => setShowLoading(true), 300);
    return () => clearTimeout(t);
  }, [loading]);

  const rate = errors.filter((e) => e.kind === "rate-limit");
  const failed = errors.filter((e) => e.kind === "error");

  let content: ReactNode = null;
  if (rate.length > 0) {
    const names = uniq(rate.map((e) => e.label)).join(", ");
    content = (
      <span
        className="status-slot__msg status-slot__msg--warn"
        title={`Open-Meteo is rate-limiting requests (HTTP 429): ${names}. Showing cached data where available; fresh data may be delayed.`}
      >
        <span className="status-slot__dot" aria-hidden="true" />
        Rate-limited · showing saved data
        <button type="button" className="status-slot__x" onClick={clearStatusErrors} aria-label="Dismiss">
          ✕
        </button>
      </span>
    );
  } else if (failed.length > 0) {
    const names = uniq(failed.map((e) => e.label)).join(", ");
    content = (
      <span className="status-slot__msg status-slot__msg--error" title={failed[0].message}>
        <span className="status-slot__dot" aria-hidden="true" />
        Couldn’t update {names}
        <button type="button" className="status-slot__x" onClick={clearStatusErrors} aria-label="Dismiss">
          ✕
        </button>
      </span>
    );
  } else if (showLoading) {
    content = (
      <span className="status-slot__msg status-slot__msg--load">
        <span className="status-slot__dot status-slot__dot--pulse" aria-hidden="true" />
        Updating…
      </span>
    );
  }

  return (
    <div className="status-slot" role="status" aria-live="polite">
      {content}
    </div>
  );
}
