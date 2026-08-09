import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheStats, clearCache, pruneCache, readCache, writeCache } from "./httpCache";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-07-22T10:30:00Z");

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("httpCache freshness", () => {
  it("returns a fresh hit within the same clock hour", () => {
    writeCache("u1", { v: 1 });
    vi.setSystemTime(T0 + 20 * 60 * 1000); // +20 min, same hour
    const hit = readCache<{ v: number }>("u1");
    expect(hit).toEqual({ body: { v: 1 }, fresh: true });
  });

  it("marks a hit from a previous hour as stale (still returned as a fallback)", () => {
    writeCache("u1", { v: 1 });
    vi.setSystemTime(T0 + HOUR); // next clock hour
    const hit = readCache<{ v: number }>("u1");
    expect(hit).toEqual({ body: { v: 1 }, fresh: false });
  });

  it("returns null (and evicts) once past the ~2-day hard TTL", () => {
    writeCache("u1", { v: 1 });
    vi.setSystemTime(T0 + 2 * 24 * HOUR + HOUR); // > 2 days later
    expect(readCache("u1")).toBeNull();
    expect(cacheStats().count).toBe(0); // the stale entry was removed on read
  });

  it("returns null for an unknown url", () => {
    expect(readCache("nope")).toBeNull();
  });
});

describe("httpCache maintenance", () => {
  it("prune drops hard-expired entries but keeps recent ones", () => {
    writeCache("old", { v: 0 });
    vi.setSystemTime(T0 + 3 * 24 * HOUR);
    writeCache("new", { v: 1 });
    pruneCache(false);
    expect(readCache("old")).toBeNull();
    expect(readCache<{ v: number }>("new")).toMatchObject({ body: { v: 1 } });
  });

  it("evicts by SIZE, not just entry count, so a few huge entries can't wedge the cache", () => {
    // The optimizer's 90-day history downloads are hundreds of KB each. A count-only
    // bound (MAX_ENTRIES = 60) never fires for a handful of them, so nothing was evicted
    // on a quota failure and every later write — forecast, air quality, radar — failed
    // silently from then on.
    const big = "x".repeat(600_000); // ~600 KB per entry, 6 entries ≈ 3.6 MB
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(T0 + i * 1000); // distinct ages so "oldest first" is well defined
      writeCache(`big${i}`, big);
    }
    expect(cacheStats().count).toBe(6); // far under MAX_ENTRIES — count alone won't act
    pruneCache(true);
    const after = cacheStats();
    expect(after.bytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(after.count).toBeLessThan(6);
    // Oldest go first, so the most recent write must survive.
    expect(readCache("big5")).not.toBeNull();
    expect(readCache("big0")).toBeNull();
  });

  it("clearCache removes every namespaced entry and reports the count", () => {
    writeCache("a", 1);
    writeCache("b", 2);
    localStorage.setItem("wv-theme", "dark"); // unrelated key must survive
    expect(clearCache()).toBe(2);
    expect(cacheStats().count).toBe(0);
    expect(localStorage.getItem("wv-theme")).toBe("dark");
  });

  it("cacheStats counts entries and approximate bytes", () => {
    writeCache("a", { hello: "world" });
    const stats = cacheStats();
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it("tolerates a corrupt entry (returns null, does not throw)", () => {
    localStorage.setItem("wv:cache:v1:bad", "{not json");
    expect(readCache("bad")).toBeNull();
  });
});
