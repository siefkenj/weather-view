import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStatus,
  beginRequest,
  cancelRequest,
  clearStatusErrors,
  failRequest,
  getSnapshot,
  subscribe,
  succeedRequest,
} from "./statusStore";

beforeEach(() => __resetStatus());

describe("statusStore active tracking", () => {
  it("adds an in-flight request and removes it on success", () => {
    const id = beginRequest("forecast");
    expect(getSnapshot().active).toEqual([{ id, label: "forecast" }]);
    succeedRequest(id);
    expect(getSnapshot().active).toEqual([]);
  });

  it("tracks multiple concurrent requests independently", () => {
    const a = beginRequest("forecast");
    const b = beginRequest("wind");
    expect(getSnapshot().active.map((r) => r.label)).toEqual(["forecast", "wind"]);
    succeedRequest(a);
    expect(getSnapshot().active.map((r) => r.label)).toEqual(["wind"]);
    succeedRequest(b);
    expect(getSnapshot().active).toEqual([]);
  });

  it("notifies subscribers on change with a fresh snapshot reference", () => {
    const seen: number[] = [];
    const unsub = subscribe(() => seen.push(getSnapshot().active.length));
    const before = getSnapshot();
    const id = beginRequest("forecast");
    expect(getSnapshot()).not.toBe(before); // new immutable snapshot
    succeedRequest(id);
    unsub();
    expect(seen).toEqual([1, 0]);
  });
});

describe("statusStore error reporting", () => {
  it("records a 429 as a rate-limit error", () => {
    const id = beginRequest("air quality");
    failRequest(id, { label: "air quality", status: 429, message: "429 Too Many Requests" });
    const { active, errors } = getSnapshot();
    expect(active).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ label: "air quality", kind: "rate-limit", status: 429 });
  });

  it("records a non-429 failure as a generic error", () => {
    const id = beginRequest("radar");
    failRequest(id, { label: "radar", status: 503, message: "503" });
    expect(getSnapshot().errors[0]).toMatchObject({ label: "radar", kind: "error", status: 503 });
  });

  it("keeps one error per label, latest first", () => {
    failRequest(beginRequest("forecast"), { label: "forecast", status: 500, message: "a" });
    failRequest(beginRequest("wind"), { label: "wind", status: 429, message: "b" });
    failRequest(beginRequest("forecast"), { label: "forecast", status: 429, message: "c" });
    const { errors } = getSnapshot();
    expect(errors.map((e) => e.label)).toEqual(["forecast", "wind"]); // deduped, newest first
    expect(errors[0]).toMatchObject({ status: 429, message: "c" });
  });

  it("clears a label's error when a later request for it succeeds", () => {
    failRequest(beginRequest("forecast"), { label: "forecast", status: 429, message: "x" });
    expect(getSnapshot().errors).toHaveLength(1);
    succeedRequest(beginRequest("forecast"));
    expect(getSnapshot().errors).toEqual([]);
  });

  it("cancel removes the active request but leaves recorded errors intact", () => {
    failRequest(beginRequest("forecast"), { label: "forecast", status: 429, message: "x" });
    const id = beginRequest("forecast");
    cancelRequest(id);
    expect(getSnapshot().active).toEqual([]);
    expect(getSnapshot().errors).toHaveLength(1); // abort is not a resolution
  });

  it("clearStatusErrors empties the error list only", () => {
    const id = beginRequest("wind");
    failRequest(id, { label: "wind", status: 429, message: "x" });
    beginRequest("forecast"); // still in flight
    clearStatusErrors();
    expect(getSnapshot().errors).toEqual([]);
    expect(getSnapshot().active.map((a) => a.label)).toEqual(["forecast"]);
  });
});

describe("statusStore timestamps", () => {
  it("stamps errors with the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T10:00:00Z"));
    failRequest(beginRequest("forecast"), { label: "forecast", status: 429, message: "x" });
    expect(getSnapshot().errors[0].at).toBe(Date.parse("2026-07-22T10:00:00Z"));
    vi.useRealTimers();
  });
});
