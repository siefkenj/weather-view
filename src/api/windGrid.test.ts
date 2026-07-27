import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWindPoints,
  sampleWindGridAt,
  windLatticePoints,
  latticeStepDeg,
  dataZoomFor,
  idwVector,
  DATA_MAX_ZOOM,
  WindFieldCache,
  type WindGrid,
} from "./windGrid";

describe("fetchWindPoints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests hourly wind for exactly the given points in one call", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.pathname).toContain("forecast");
      expect(u.searchParams.get("hourly")).toBe("wind_speed_10m,wind_direction_10m");
      expect((u.searchParams.get("latitude") ?? "").split(",")).toHaveLength(2);
      return {
        ok: true,
        json: async () => [
          { latitude: 1, longitude: 2, hourly: { time: [0, 3600], wind_speed_10m: [10, 20], wind_direction_10m: [0, 90] } },
          { latitude: 3, longitude: 4, hourly: { time: [0, 3600], wind_speed_10m: [5, 5], wind_direction_10m: [180, 180] } },
        ],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const grid = await fetchWindPoints([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(grid.times).toEqual([0, 3600]);
    expect(grid.points[0]).toEqual({ lat: 1, lon: 2, speed: [10, 20], dir: [0, 90] });
  });

  it("makes no request for an empty point list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const grid = await fetchWindPoints([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(grid.points).toEqual([]);
  });
});

describe("lattice quantization", () => {
  it("halves the step for each zoom level (constant on-screen density)", () => {
    expect(latticeStepDeg(8)).toBeCloseTo(latticeStepDeg(9) * 2);
  });

  it("keeps stable cell keys across a small pan at the same zoom", () => {
    const z = 9;
    const a = windLatticePoints({ south: 40, west: -80, north: 41, east: -79 }, z);
    const b = windLatticePoints({ south: 40.02, west: -79.98, north: 41.02, east: -78.98 }, z);
    const aKeys = new Set(a.map((p) => p.key));
    const shared = b.filter((p) => aKeys.has(p.key)).length;
    // A tiny pan should reuse most cells rather than mint an all-new grid.
    expect(shared).toBeGreaterThan(b.length * 0.5);
  });

  it("produces different keys at different zoom levels", () => {
    const bounds = { south: 40, west: -80, north: 41, east: -79 };
    const z9 = new Set(windLatticePoints(bounds, 9).map((p) => p.key));
    const z10 = windLatticePoints(bounds, 10).map((p) => p.key);
    expect(z10.some((k) => z9.has(k))).toBe(false);
  });
});

describe("dataZoomFor", () => {
  it("caps the data zoom so zooming past the model resolution reuses the cache", () => {
    expect(dataZoomFor(8)).toBe(8);
    expect(dataZoomFor(DATA_MAX_ZOOM)).toBe(DATA_MAX_ZOOM);
    // Every zoom past the cap maps to the SAME data zoom → same lattice → no refetch.
    expect(dataZoomFor(13)).toBe(DATA_MAX_ZOOM);
    expect(dataZoomFor(18)).toBe(DATA_MAX_ZOOM);
    expect(dataZoomFor(13)).toBe(dataZoomFor(18));
  });
});

describe("idwVector", () => {
  const pts = [
    { x: 0, y: 0, u: 10, v: 0 },
    { x: 100, y: 0, u: -10, v: 0 },
  ];

  it("returns a coincident sample exactly", () => {
    expect(idwVector(pts, 0, 0)).toEqual({ u: 10, v: 0 });
  });

  it("blends between samples (fills the gap) — midpoint averages them", () => {
    const mid = idwVector(pts, 50, 0)!;
    expect(mid.u).toBeCloseTo(0); // symmetric → cancels
    expect(idwVector(pts, 20, 0)!.u).toBeGreaterThan(0); // nearer the +10 sample
  });

  it("is null only with no samples", () => {
    expect(idwVector([], 5, 5)).toBeNull();
  });
});

describe("WindFieldCache", () => {
  const bounds = { south: 40, west: -80, north: 41, east: -79 };
  const gridFor = (pts: { lat: number; lon: number }[]): WindGrid => ({
    times: [0, 3600],
    points: pts.map((p) => ({ lat: p.lat, lon: p.lon, speed: [12, 12], dir: [90, 90] })),
  });

  it("reports all points missing, then none after a merge", () => {
    const cache = new WindFieldCache();
    const pts = windLatticePoints(bounds, 9);
    expect(cache.missing(pts)).toHaveLength(pts.length);
    cache.merge(pts, gridFor(pts));
    expect(cache.missing(pts)).toHaveLength(0);
    expect(cache.size).toBe(pts.length);
  });

  it("only reports the newly-revealed cells missing after a pan", () => {
    const cache = new WindFieldCache();
    const a = windLatticePoints(bounds, 9);
    cache.merge(a, gridFor(a));
    const b = windLatticePoints({ south: 40.1, west: -79.9, north: 41.1, east: -78.9 }, 9);
    const missing = cache.missing(b);
    // Some cells overlap (cached) so we fetch strictly fewer than a whole new grid.
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.length).toBeLessThan(b.length);
  });

  it("samples only the cached visible cells at a time", () => {
    const cache = new WindFieldCache();
    const pts = windLatticePoints(bounds, 9).slice(0, 3);
    cache.merge(pts, gridFor(pts));
    const samples = cache.samplesAt(pts, 0);
    expect(samples).toHaveLength(3);
    // dir 90 (from east) → blowing west: u < 0, v ≈ 0.
    expect(samples[0].u).toBeLessThan(0);
    expect(samples[0].speed).toBeCloseTo(12);
  });
});

describe("sampleWindGridAt", () => {
  const grid: WindGrid = {
    times: [0, 3600],
    points: [{ lat: 1, lon: 2, speed: [10, 20], dir: [0, 90] }],
  };

  it("interpolates the vector (not the angle) between hours", () => {
    // dir 0 (from N) → (0,-10); dir 90 (from E) → (-20,0); halfway = (-10,-5).
    const [s] = sampleWindGridAt(grid, 1800);
    expect(s.u).toBeCloseTo(-10);
    expect(s.v).toBeCloseTo(-5);
    expect(s.speed).toBeCloseTo(Math.hypot(-10, -5));
  });

  it("returns null speed for an empty grid", () => {
    expect(sampleWindGridAt({ times: [], points: [{ lat: 1, lon: 2, speed: [], dir: [] }] }, 0)[0].speed).toBeNull();
  });
});
