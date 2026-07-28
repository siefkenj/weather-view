import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, HttpError } from "./http";
import { clearCache, writeCache } from "./httpCache";
import { __resetStatus, getSnapshot } from "../status/statusStore";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const err = (status: number, statusText: string, body?: unknown) =>
  ({
    ok: false,
    status,
    statusText,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  }) as Response;

beforeEach(() => {
  __resetStatus();
  clearCache();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-07-22T10:30:00Z"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchJson success", () => {
  it("returns parsed JSON and leaves nothing in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ hello: "world" })));
    const data = await fetchJson<{ hello: string }>("https://x/a", { label: "forecast" });
    expect(data).toEqual({ hello: "world" });
    expect(getSnapshot().active).toEqual([]);
    expect(getSnapshot().errors).toEqual([]);
  });

  it("caches when cache:true and serves a same-hour hit without refetching", async () => {
    const fetchMock = vi.fn(async () => ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("https://x/b", { label: "wind", cache: true });
    await fetchJson("https://x/b", { label: "wind", cache: true }); // fresh hit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not consult the cache when cache is unset", async () => {
    const fetchMock = vi.fn(async () => ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("https://x/c", { label: "search" });
    await fetchJson("https://x/c", { label: "search" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchJson failures", () => {
  it("throws HttpError with the status and records a generic error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => err(503, "Service Unavailable")));
    await expect(fetchJson("https://x/d", { label: "radar" })).rejects.toThrow(/503/);
    const [e] = getSnapshot().errors;
    expect(e).toMatchObject({ label: "radar", kind: "error", status: 503 });
  });

  it("uses the reason field from the error body in the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => err(400, "Bad Request", { reason: "invalid latitude" })));
    await expect(fetchJson("https://x/e", { label: "forecast" })).rejects.toThrow(/invalid latitude/);
  });

  it("reports a 429 as a rate-limit error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => err(429, "Too Many Requests")));
    await expect(fetchJson("https://x/f", { label: "air map", cache: true })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(getSnapshot().errors[0]).toMatchObject({ label: "air map", kind: "rate-limit", status: 429 });
  });

  it("serves a stale cache entry as a fallback on 429 (and still reports it)", async () => {
    writeCache("https://x/g", { cached: true });
    vi.setSystemTime(Date.parse("2026-07-22T12:00:00Z")); // later hour → entry is stale, not fresh
    vi.stubGlobal("fetch", vi.fn(async () => err(429, "Too Many Requests")));
    const data = await fetchJson<{ cached: boolean }>("https://x/g", { label: "forecast", cache: true });
    expect(data).toEqual({ cached: true }); // stale data returned instead of throwing
    expect(getSnapshot().errors[0]).toMatchObject({ kind: "rate-limit" });
  });

  it("treats an aborted request as a cancellation, not an error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(
      fetchJson("https://x/h", { label: "forecast", signal: controller.signal }),
    ).rejects.toThrow();
    expect(getSnapshot().active).toEqual([]);
    expect(getSnapshot().errors).toEqual([]); // no user-facing error for an abort
  });
});
