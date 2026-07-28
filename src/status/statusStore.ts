// A tiny external store (outside Redux) for transient network status: which
// requests are in flight and which recently failed — surfaced by <StatusBar>.
//
// It's driven from the single HTTP chokepoint (api/http.ts), so it captures
// EVERY network call — the RTK Query endpoints and the direct grid/radar
// fetches alike — including 429 "too many requests". This state is ephemeral
// and never persisted, so it stays out of Redux/URL; the UI subscribes with
// useSyncExternalStore (see hooks/useNetworkStatus). The module is React-free so
// the plain fetch layer can import it without pulling in React.

export interface ActiveRequest {
  id: number;
  label: string;
}

export type StatusErrorKind = "rate-limit" | "error";

export interface StatusError {
  label: string;
  kind: StatusErrorKind;
  status?: number;
  message: string;
  /** When it was recorded (ms epoch). */
  at: number;
}

export interface NetworkStatus {
  active: ActiveRequest[];
  errors: StatusError[];
}

/** Cap on retained errors — newest first, one per label. */
const MAX_ERRORS = 6;

let active: ActiveRequest[] = [];
let errors: StatusError[] = [];
let snapshot: NetworkStatus = { active, errors };
let nextId = 1;
const listeners = new Set<() => void>();

// Recompute the immutable snapshot and notify subscribers. getSnapshot must return
// a stable reference between changes (else useSyncExternalStore loops), so we only
// build a new object here, on an actual mutation.
function commit(): void {
  snapshot = { active, errors };
  for (const listener of listeners) listener();
}

/** Mark a request in flight. Returns an id to pass to succeed/fail/cancel. */
export function beginRequest(label: string): number {
  const id = nextId++;
  active = [...active, { id, label }];
  commit();
  return id;
}

/** A request finished OK: drop it from active and clear any error for its label. */
export function succeedRequest(id: number): void {
  const req = active.find((a) => a.id === id);
  const nextActive = active.filter((a) => a.id !== id);
  const nextErrors = req ? errors.filter((e) => e.label !== req.label) : errors;
  if (nextActive === active && nextErrors === errors) return;
  active = nextActive;
  errors = nextErrors;
  commit();
}

/** A request was aborted (e.g. location changed): drop it from active but leave any
 *  recorded error for its label in place (an abort isn't a resolution). */
export function cancelRequest(id: number): void {
  const nextActive = active.filter((a) => a.id !== id);
  if (nextActive.length === active.length) return;
  active = nextActive;
  commit();
}

/** A request failed: drop it from active and record the error (429 → "rate-limit"). */
export function failRequest(
  id: number,
  info: { label: string; status?: number; message: string },
): void {
  active = active.filter((a) => a.id !== id);
  const kind: StatusErrorKind = info.status === 429 ? "rate-limit" : "error";
  errors = [
    { label: info.label, kind, status: info.status, message: info.message, at: Date.now() },
    ...errors.filter((e) => e.label !== info.label), // one error per label, latest wins
  ].slice(0, MAX_ERRORS);
  commit();
}

/** Dismiss all recorded errors (leaves the in-flight list untouched). */
export function clearStatusErrors(): void {
  if (errors.length === 0) return;
  errors = [];
  commit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): NetworkStatus {
  return snapshot;
}

/** Test helper: reset all module state between tests. */
export function __resetStatus(): void {
  active = [];
  errors = [];
  snapshot = { active, errors };
  nextId = 1;
  listeners.clear();
}
