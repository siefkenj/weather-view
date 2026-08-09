// Truth selection for the rain-timing optimizer. The choice between a real gauge and
// ERA5 reanalysis decides what every model combination is scored against, so getting it
// wrong doesn't error — it silently ranks on the wrong (or far too little) data.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "./types";

const fetchStationPrecipWindowUtc = vi.fn();
const fetchJson = vi.fn();

vi.mock("./eccc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./eccc")>()),
  fetchStationPrecipWindowUtc: (...args: unknown[]) => fetchStationPrecipWindowUtc(...args),
}));
vi.mock("./http", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

const { fetchTruthPrecip, fetchModelPrecipHistory, MIN_GAUGE_COVERAGE } = await import("./modelHistory");

const PLACE: Place = {
  name: "Toronto",
  latitude: 43.65,
  longitude: -79.38,
  timezone: "America/Toronto",
};

const START = "2026-01-01";
const END = "2026-04-06"; // 96 days inclusive = 2304 hours

const STATION = {
  stnId: 49389,
  name: "TORONTO CITY",
  latitude: 43.67,
  longitude: -79.4,
  distanceKm: 4.1,
};

/** `n` UTC hours of measured rain starting at the window's first hour. */
function gaugeHours(n: number): Record<string, number> {
  const out: Record<string, number> = {};
  const t0 = Date.parse(`${START}T00:00Z`);
  for (let i = 0; i < n; i++) {
    out[new Date(t0 + i * 3_600_000).toISOString().slice(0, 16)] = 0;
  }
  return out;
}

/** An ERA5 archive response body. */
const era5 = () => ({ hourly: { time: [`${START}T00:00`], precipitation: [1.2] } });

beforeEach(() => {
  fetchStationPrecipWindowUtc.mockReset();
  fetchJson.mockReset();
});

describe("fetchTruthPrecip gauge-vs-reanalysis choice", () => {
  it("uses a gauge that covers the window", async () => {
    fetchStationPrecipWindowUtc.mockResolvedValue({
      station: STATION,
      precipByUtc: gaugeHours(2300), // ~100% of 2304
    });
    const truth = await fetchTruthPrecip(PLACE, START, END);
    expect(truth.source).toBe("gauge");
    expect(truth.label).toBe("TORONTO CITY gauge · 4 km");
    // The models must be sampled AT the gauge, not at the place.
    expect(truth.point).toEqual({ latitude: STATION.latitude, longitude: STATION.longitude });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("falls back to ERA5 when the gauge only covers part of the window", async () => {
    // Thunder Bay's nearest active station really does return ~346 rows for a 2328-hour
    // window. A bare "returned at least one row" test let that win and threw away 90 days
    // of usable reanalysis to rank every combination on two weeks.
    fetchStationPrecipWindowUtc.mockResolvedValue({
      station: STATION,
      precipByUtc: gaugeHours(346),
    });
    fetchJson.mockResolvedValue(era5());
    const truth = await fetchTruthPrecip(PLACE, START, END);
    expect(truth.source).toBe("reanalysis");
    expect(truth.station).toBeNull();
    expect(truth.point).toEqual({ latitude: PLACE.latitude, longitude: PLACE.longitude });
  });

  it("keeps a gauge sitting exactly on the coverage bar", async () => {
    fetchStationPrecipWindowUtc.mockResolvedValue({
      station: STATION,
      precipByUtc: gaugeHours(Math.ceil(MIN_GAUGE_COVERAGE * 2304)),
    });
    expect((await fetchTruthPrecip(PLACE, START, END)).source).toBe("gauge");
  });

  it("falls through to ERA5 when the ECCC request fails", async () => {
    // The gauge lookup is NOT gated to Canada — it runs for every location on earth, and
    // out-of-range bboxes (poles, antimeridian) and ECCC outages both answer HTTP 500.
    // That must not sink a run ERA5 can serve.
    fetchStationPrecipWindowUtc.mockRejectedValue(new Error("gauge stations request failed: 500"));
    fetchJson.mockResolvedValue(era5());
    const truth = await fetchTruthPrecip(PLACE, START, END);
    expect(truth.source).toBe("reanalysis");
    expect(truth.precip).toEqual({ [`${START}T00:00`]: 1.2 });
  });

  it("still propagates an abort rather than quietly downgrading to ERA5", async () => {
    fetchStationPrecipWindowUtc.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchTruthPrecip(PLACE, START, END)).rejects.toThrow(/abort/i);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("trims the reanalysis window short of the IFS-filled tail", async () => {
    fetchStationPrecipWindowUtc.mockResolvedValue({ station: null, precipByUtc: {} });
    fetchJson.mockResolvedValue(era5());
    await fetchTruthPrecip(PLACE, START, END);
    const url = new URL(fetchJson.mock.calls[0][0] as string);
    expect(url.searchParams.get("start_date")).toBe(START);
    expect(url.searchParams.get("end_date")).toBe("2026-03-31"); // END − 6 days
    expect(url.searchParams.get("timezone")).toBe("GMT");
  });
});

describe("fetchModelPrecipHistory", () => {
  it("yields an empty result rather than throwing when `hourly.time` is missing", async () => {
    fetchJson.mockResolvedValue({ hourly: { precipitation_gfs_seamless: [1, 2] } });
    await expect(fetchModelPrecipHistory({ latitude: 1, longitude: 2 }, START, END)).resolves.toEqual({
      models: [],
      byModel: {},
    });
  });

  it("drops a model whose series duplicates one already kept", async () => {
    // Regional "seamless" models fall back to a global backbone outside their region, and
    // a duplicate is worse than a wasted slot — it double-weights that model in every
    // median. 14+ days of identical hours is the bar.
    const time: string[] = [];
    const vals: number[] = [];
    const t0 = Date.parse(`${START}T00:00Z`);
    for (let i = 0; i < 24 * 20; i++) {
      time.push(new Date(t0 + i * 3_600_000).toISOString().slice(0, 16));
      vals.push(i % 7 === 0 ? 0.6 : 0);
    }
    fetchJson.mockResolvedValue({
      hourly: {
        time,
        precipitation_ecmwf_ifs025: vals,
        precipitation_knmi_seamless: [...vals], // the echo
        precipitation_gfs_seamless: vals.map((v) => (v ? 0 : 0.8)), // genuinely different
      },
    });
    const out = await fetchModelPrecipHistory({ latitude: 1, longitude: 2 }, START, END);
    expect(out.models).toEqual(["ecmwf_ifs025", "gfs_seamless"]);
    expect(out.models).not.toContain("knmi_seamless");
  });
});
