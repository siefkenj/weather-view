import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { openMeteoApi } from "./openMeteoApi";

function makeStore() {
  return configureStore({
    reducer: { [openMeteoApi.reducerPath]: openMeteoApi.reducer },
    middleware: (gdm) => gdm().concat(openMeteoApi.middleware),
  });
}

const place = { latitude: 43.7064, longitude: -79.3986, timezone: "America/Toronto" };

describe("openMeteoApi cache keys", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keys every weather endpoint on the same lon,lat location (one entry per source)", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const store = makeStore();

    store.dispatch(openMeteoApi.endpoints.forecast.initiate({ ...place, forecastDays: 16, pastDays: 92 }));
    store.dispatch(openMeteoApi.endpoints.minutely.initiate(place));
    store.dispatch(openMeteoApi.endpoints.ensemble.initiate({ ...place, forecastDays: 16 }));
    store.dispatch(openMeteoApi.endpoints.airQuality.initiate({ ...place, forecastDays: 7, pastDays: 92 }));

    // The cache entry keys are created synchronously on dispatch (pending state).
    const keys = Object.keys(store.getState().openMeteoApi.queries);
    expect(keys.sort()).toEqual(
      [
        "airQuality(-79.3986,43.7064)",
        "ensemble(-79.3986,43.7064)",
        "forecast(-79.3986,43.7064)",
        "minutely(-79.3986,43.7064)",
      ].sort(),
    );
  });

  it("collapses a second range for the same location into the same forecast entry", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const store = makeStore();

    store.dispatch(openMeteoApi.endpoints.forecast.initiate({ ...place, forecastDays: 16, pastDays: 92 }));
    store.dispatch(openMeteoApi.endpoints.forecast.initiate({ ...place, forecastDays: 1, pastDays: 0 }));

    const forecastKeys = Object.keys(store.getState().openMeteoApi.queries).filter((k) =>
      k.startsWith("forecast("),
    );
    // Range lives outside the key → both ranges share one per-location entry
    // (the seam for future progressive/day-first loading).
    expect(forecastKeys).toEqual(["forecast(-79.3986,43.7064)"]);
  });
});
