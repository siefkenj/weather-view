import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aqiAlpha,
  aqiColor,
  aqhiAlpha,
  aqhiColor,
  aqiGridPoints,
  airFieldColor,
  airFieldAlpha,
  fetchAqiGrid,
  sampleAqiGridAt,
  AQI_GRID_N,
  type AqiGrid,
} from "./airQualityGrid";

describe("aqiGridPoints", () => {
  it("spans the bounds corners inclusively as an n×n grid", () => {
    const pts = aqiGridPoints({ south: 40, west: -80, north: 46, east: -74 });
    expect(pts).toHaveLength(AQI_GRID_N * AQI_GRID_N);
    expect(pts[0]).toEqual({ lat: 40, lon: -80 }); // SW corner
    expect(pts[pts.length - 1]).toEqual({ lat: 46, lon: -74 }); // NE corner
  });

  it("uses the bounds centre when n is 1", () => {
    expect(aqiGridPoints({ south: 40, west: -80, north: 46, east: -74 }, 1)).toEqual([
      { lat: 43, lon: -77 },
    ]);
  });
});

describe("unified air-quality colour scheme", () => {
  it("uses the SAME ramp for AQI and AQHI (identical colours at the shared endpoints)", () => {
    // Good (AQI 0) and Low (AQHI 1) both sit at the ramp's green start; Hazardous
    // (AQI 500) and Very high (AQHI 11) both at its umber end.
    expect(aqiColor(0)).toEqual(aqhiColor(1)); // both green
    expect(aqiColor(500)).toEqual(aqhiColor(11)); // both umber
    // Green at the low end, dark red-brown (umber) at the top.
    const good = aqiColor(0);
    expect(good[1]).toBeGreaterThan(good[0]); // green > red
    const worst = aqhiColor(11);
    expect(worst[0]).toBeGreaterThan(worst[1]); // red > green (dark)
    expect(worst[0]).toBeLessThan(160); // umber is dark
  });

  it("progresses monotonically from green toward red as severity rises", () => {
    expect(aqiColor(25)[1]).toBeGreaterThan(aqiColor(300)[1]); // green fades out
    expect(aqhiColor(2)[1]).toBeGreaterThan(aqhiColor(10)[1]);
    expect(aqiColor(9999)).toEqual(aqiColor(500)); // clamps at the top
  });

  it("is transparent at low risk (≤3) and fades in above", () => {
    expect(aqhiAlpha(1)).toBe(0);
    expect(aqhiAlpha(3)).toBe(0);
    expect(aqhiAlpha(5)).toBeCloseTo(0.6);
    expect(aqhiAlpha(4)).toBeGreaterThan(0);
    expect(aqhiAlpha(4)).toBeLessThan(0.6);
  });

  it("airField* dispatch on the mode", () => {
    expect(airFieldColor(4, "aqhi")).toEqual(aqhiColor(4));
    expect(airFieldColor(100, "aqi")).toEqual(aqiColor(100));
    expect(airFieldAlpha(5, "aqhi")).toBe(aqhiAlpha(5));
    expect(airFieldAlpha(75, "aqi")).toBe(aqiAlpha(75));
  });
});

describe("aqiAlpha", () => {
  it("is fully transparent for good air and semi-opaque above the fade window", () => {
    expect(aqiAlpha(0)).toBe(0);
    expect(aqiAlpha(50)).toBe(0); // still good
    expect(aqiAlpha(100)).toBeCloseTo(0.6); // fully faded in at top of Moderate
    expect(aqiAlpha(180)).toBeCloseTo(0.6); // stays semi
  });

  it("keeps the greenish low-moderate band faint (ramps across 50→100)", () => {
    expect(aqiAlpha(75)).toBeCloseTo(0.3); // midpoint → half opacity
    expect(aqiAlpha(60)).toBeLessThan(aqiAlpha(90)); // fainter the closer to good
    expect(aqiAlpha(60)).toBeGreaterThan(0);
  });
});

describe("sampleAqiGridAt", () => {
  const grid: AqiGrid = {
    times: [1000, 2000, 3000],
    points: [
      { lat: 1, lon: 2, values: [10, 60, 110] },
      { lat: 3, lon: 4, values: [20, 70, null] },
    ],
  };

  it("linearly interpolates between the two bracketing hours", () => {
    // 1900 is 90% of the way from t=1000 to t=2000.
    expect(sampleAqiGridAt(grid, 1900)).toEqual([
      { lat: 1, lon: 2, aqi: 10 + (60 - 10) * 0.9 }, // 55
      { lat: 3, lon: 4, aqi: 20 + (70 - 20) * 0.9 }, // 65
    ]);
    // Exact midpoint of the first interval.
    expect(sampleAqiGridAt(grid, 1500)[0].aqi).toBe(35);
  });

  it("returns the exact value at a grid time", () => {
    expect(sampleAqiGridAt(grid, 2000)).toEqual([
      { lat: 1, lon: 2, aqi: 60 },
      { lat: 3, lon: 4, aqi: 70 },
    ]);
  });

  it("clamps to the ends and passes through nulls", () => {
    expect(sampleAqiGridAt(grid, 9999)).toEqual([
      { lat: 1, lon: 2, aqi: 110 },
      { lat: 3, lon: 4, aqi: null }, // both bracket values null at the end
    ]);
  });

  it("yields null samples for an empty grid", () => {
    expect(sampleAqiGridAt({ times: [], points: [{ lat: 1, lon: 2, values: [] }] }, 0)).toEqual([
      { lat: 1, lon: 2, aqi: null },
    ]);
  });
});

describe("fetchAqiGrid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("issues one multi-location hourly request and returns a time-indexed grid", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.pathname).toContain("air-quality");
      expect(u.searchParams.get("hourly")).toBe("us_aqi");
      expect(u.searchParams.get("timeformat")).toBe("unixtime");
      // comma-joined coordinates → one request for the whole grid
      expect((u.searchParams.get("latitude") ?? "").split(",").length).toBeGreaterThan(1);
      return {
        ok: true,
        json: async () => [
          { latitude: 43.7, longitude: -79.4, hourly: { time: [1000, 2000], us_aqi: [40, 90] } },
          { latitude: 45.4, longitude: -75.7, hourly: { time: [1000, 2000], us_aqi: [55, null] } },
        ],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const grid = await fetchAqiGrid({ south: 43, west: -80, north: 46, east: -75 }, "aqi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(grid.times).toEqual([1000, 2000]);
    expect(grid.points).toEqual([
      { lat: 43.7, lon: -79.4, values: [40, 90] },
      { lat: 45.4, lon: -75.7, values: [55, null] },
    ]);
  });

  it("tolerates a single-object (non-array) response", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ latitude: 1, longitude: 2, hourly: { time: [500], us_aqi: [30] } }),
    }));
    const grid = await fetchAqiGrid({ south: 0, west: 0, north: 1, east: 1 }, "aqi");
    expect(grid.times).toEqual([500]);
    expect(grid.points).toEqual([{ lat: 1, lon: 2, values: [30] }]);
  });

  it("in AQHI mode requests the pollutants and computes the index per point", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("hourly")).toBe("pm2_5,ozone,nitrogen_dioxide");
      return {
        ok: true,
        json: async () => [
          {
            latitude: 43.7,
            longitude: -79.4,
            hourly: { time: [1000, 2000], pm2_5: [8, 8], ozone: [40, 40], nitrogen_dioxide: [12, 12] },
          },
        ],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const grid = await fetchAqiGrid({ south: 43, west: -80, north: 46, east: -75 }, "aqhi");
    expect(grid.times).toEqual([1000, 2000]);
    // Computed AQHI values are small positive integers (≥1), not the raw pollutants.
    const v = grid.points[0].values;
    expect(v).toHaveLength(2);
    expect(v[0]).toBeGreaterThanOrEqual(1);
    expect(v[0]).toBeLessThan(10);
  });
});
