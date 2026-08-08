// Switching cities keeps the dashboard mounted (LocationPage no longer remounts it), so
// these components must render their full shape with "–" in every value slot while the
// new location's data is in flight. Blank or missing widgets are the bug being guarded.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { CurrentConditions } from "./CurrentConditions";
import { AirQualityPanel } from "./AirQualityPanel";
import { openMeteoApi } from "../store/openMeteoApi";
import { viewReducer } from "../store/viewSlice";
import { themeReducer } from "../store/themeSlice";
import { readoutReducer } from "../store/readoutSlice";
import type { DailySummary } from "../utils/series";
import type { ForecastCurrent, Place } from "../api/types";

const PLACE: Place = {
  name: "Toronto",
  latitude: 43.65,
  longitude: -79.38,
  timezone: "America/Toronto",
};

function renderWithApp(ui: React.ReactElement) {
  const store = configureStore({
    reducer: {
      [openMeteoApi.reducerPath]: openMeteoApi.reducer,
      view: viewReducer,
      theme: themeReducer,
      readout: readoutReducer,
    },
    middleware: (d) => d().concat(openMeteoApi.middleware),
  });
  return render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );
}

/** The label → value pairs of the facts list, as the user reads them. */
function facts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const li of document.querySelectorAll(".current__facts li")) {
    const k = li.querySelector(".fact-key")?.textContent ?? "";
    const v = li.querySelector(".fact-val")?.textContent ?? "";
    out[k] = v.trim();
  }
  return out;
}

const CURRENT: ForecastCurrent = {
  time: "2026-08-08T14:00",
  interval: 900,
  temperature_2m: 24.4,
  apparent_temperature: 26.1,
  weather_code: 3,
};

const TODAY: DailySummary = {
  date: "2026-08-08",
  code: 3,
  tempMax: 27,
  tempMin: 18,
  precipSum: 2.4,
  precipProbMax: 60,
  precipHours: 3,
  uvMax: 7,
  sunrise: "2026-08-08T06:12",
  sunset: "2026-08-08T20:31",
  windMax: 18,
  windDir: 270,
  humidity: 64,
};

describe("CurrentConditions while a city's data is loading", () => {
  it("keeps every fact row visible with a dash instead of dropping the list", () => {
    renderWithApp(<CurrentConditions place={PLACE} current={null} units="metric" />);

    // The list itself must exist — it used to be omitted entirely without `today`.
    expect(document.querySelector(".current__facts")).toBeInTheDocument();
    expect(facts()).toEqual({
      "UV max": "–",
      Rain: "–",
      Wind: "–",
      Humidity: "–",
      Sunrise: "–",
      Sunset: "–",
    });
  });

  it("dashes the temperature and condition rather than rendering nothing", () => {
    renderWithApp(<CurrentConditions place={PLACE} current={null} units="metric" />);
    expect(document.querySelector(".current__temp")).toHaveTextContent("–");
    expect(document.querySelector(".current__label")).toHaveTextContent("–");
    expect(document.querySelector(".current__feels")).toHaveTextContent("Feels like –");
  });

  it("still shows the place name and a real date for the location", () => {
    renderWithApp(<CurrentConditions place={PLACE} current={null} units="metric" />);
    expect(screen.getByRole("button", { name: /Toronto/ })).toBeInTheDocument();
    // Calendar information, not weather — it must not be a dash.
    expect(document.querySelector(".current__date")?.textContent).not.toBe("–");
  });

  it("shows the air row with dashes when the panel is on but unloaded", () => {
    renderWithApp(
      <CurrentConditions place={PLACE} current={null} units="metric" aqhi={null} aqi={null} />,
    );
    expect(facts()["AQHI (AQI)"]).toBe("– (–)");
  });

  it("omits the air row entirely when the panel is off", () => {
    renderWithApp(<CurrentConditions place={PLACE} current={null} units="metric" />);
    expect(facts()["AQHI (AQI)"]).toBeUndefined();
  });

  it("fills the same rows in once the data arrives", () => {
    renderWithApp(
      <CurrentConditions place={PLACE} current={CURRENT} today={TODAY} units="metric" />,
    );
    expect(document.querySelector(".current__temp")).toHaveTextContent("24°");
    const f = facts();
    expect(f["UV max"]).toBe("7");
    expect(f["Rain"]).toBe("2.4mm (60%)");
    expect(f["Humidity"]).toBe("64%");
    expect(f["Sunrise"]).not.toBe("–");
  });

  it("does not report a loading day as a confident zero rainfall", () => {
    renderWithApp(<CurrentConditions place={PLACE} current={CURRENT} units="metric" />);
    expect(facts()["Rain"]).toBe("–");
  });
});

describe("AirQualityPanel while a city's data is loading", () => {
  it("keeps its heading and all four tiles, dashed", () => {
    renderWithApp(<AirQualityPanel data={null} aqhi={null} nowIso={null} />);
    expect(screen.getByRole("heading", { name: "Air quality" })).toBeInTheDocument();
    const tiles = [...document.querySelectorAll(".aqi-tile")].map((t) => ({
      key: t.querySelector(".aqi-tile__key")?.textContent,
      val: t.querySelector(".aqi-tile__val")?.textContent?.trim().split(" ")[0],
    }));
    expect(tiles).toHaveLength(4);
    expect(tiles.map((t) => t.key)).toEqual(["PM2.5", "PM10", "Ozone", "NO₂"]);
    expect(tiles.every((t) => t.val === "–")).toBe(true);
    expect(document.querySelector(".aqi-aqhi")).toHaveTextContent("–");
  });
});
