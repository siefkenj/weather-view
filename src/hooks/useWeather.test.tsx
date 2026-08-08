// The dashboard is no longer remounted per city, so `useKeepData`'s "keep the last data
// on screen while refetching" behaviour is the thing standing between the user and
// Toronto's temperature displayed under Vancouver's name. It must retain across a
// widening range or a model-blend change, and drop everything across a location change.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import type { ForecastResponse, Place } from "../api/types";

const fetchForecast = vi.fn();

vi.mock("../api/openMeteo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/openMeteo")>()),
  fetchForecast: (...args: unknown[]) => fetchForecast(...args),
}));

const { useForecast } = await import("./useWeather");
const { openMeteoApi } = await import("../store/openMeteoApi");
const { viewReducer } = await import("../store/viewSlice");
const { themeReducer } = await import("../store/themeSlice");
const { readoutReducer } = await import("../store/readoutSlice");

const TORONTO: Place = { name: "Toronto", latitude: 43.65, longitude: -79.38, timezone: "America/Toronto" };
const VANCOUVER: Place = { name: "Vancouver", latitude: 49.28, longitude: -123.12, timezone: "America/Vancouver" };

/** Just enough of a forecast to tell the two cities apart. */
const forecastFor = (p: Place) =>
  ({
    latitude: p.latitude,
    longitude: p.longitude,
    timezone: p.timezone,
    current: { time: "2026-08-08T14:00", interval: 900, temperature_2m: p.latitude },
  }) as unknown as ForecastResponse;

function wrapper() {
  const store = configureStore({
    reducer: {
      [openMeteoApi.reducerPath]: openMeteoApi.reducer,
      view: viewReducer,
      theme: themeReducer,
      readout: readoutReducer,
    },
    middleware: (d) => d().concat(openMeteoApi.middleware),
  });
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

const OPTS = { forecastDays: 3, pastDays: 0 };

beforeEach(() => {
  fetchForecast.mockReset();
});

describe("useForecast across a city switch", () => {
  it("never serves the previous city's data while the new one loads", async () => {
    // Vancouver's request is held open so we can observe the in-between state.
    const van: { release: (() => void) | null } = { release: null };
    fetchForecast.mockImplementation(async (arg: { latitude: number }) => {
      if (arg.latitude === VANCOUVER.latitude) {
        await new Promise<void>((res) => (van.release = res));
      }
      return forecastFor(arg.latitude === TORONTO.latitude ? TORONTO : VANCOUVER);
    });

    const { result, rerender } = renderHook((place: Place) => useForecast(place, OPTS), {
      wrapper: wrapper(),
      initialProps: TORONTO,
    });

    await waitFor(() => expect(result.current.data?.latitude).toBe(TORONTO.latitude));

    rerender(VANCOUVER);

    // The moment the place changes — and for as long as Vancouver is in flight — there
    // must be NO data rather than Toronto's. This is what the dashboard renders as "–".
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();

    van.release!();
    await waitFor(() => expect(result.current.data?.latitude).toBe(VANCOUVER.latitude));
  });

  it("does keep the previous data when only the range widens for the same city", async () => {
    const wide: { release: (() => void) | null } = { release: null };
    fetchForecast.mockImplementation(async (arg: { forecastDays: number }) => {
      if (arg.forecastDays > 3) await new Promise<void>((res) => (wide.release = res));
      return forecastFor(TORONTO);
    });

    const { result, rerender } = renderHook(
      (opts: { forecastDays: number; pastDays: number }) => useForecast(TORONTO, opts),
      { wrapper: wrapper(), initialProps: OPTS },
    );
    await waitFor(() => expect(result.current.data?.latitude).toBe(TORONTO.latitude));

    // Stage 2 expands the range; the chart must not blank out while it lands.
    rerender({ forecastDays: 16, pastDays: 20 });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data?.latitude).toBe(TORONTO.latitude);

    wide.release?.();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });
});
