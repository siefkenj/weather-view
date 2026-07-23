import { describe, expect, it } from "vitest";
import {
  viewReducer,
  setDays,
  setView,
  toggleSeries,
  togglePanel,
} from "./viewSlice";
import { DEFAULTS, parseState, serializeState } from "./urlState";
import { placeKey } from "./openMeteoApi";

describe("viewSlice", () => {
  it("sets scalar fields", () => {
    const s = viewReducer(DEFAULTS, setDays(3));
    expect(s.days).toBe(3);
  });

  it("toggles a series off and back on", () => {
    const off = viewReducer(DEFAULTS, toggleSeries("temp")); // temp is on by default
    expect(off.series).not.toContain("temp");
    const on = viewReducer(off, toggleSeries("temp"));
    expect(on.series).toContain("temp");
  });

  it("toggles a panel", () => {
    const s = viewReducer(DEFAULTS, togglePanel("air"));
    expect(s.panels).not.toContain("air");
  });

  it("merges a partial patch via setView (used by URL→store + update)", () => {
    const s = viewReducer(DEFAULTS, setView({ units: "imperial", ci: true }));
    expect(s.units).toBe("imperial");
    expect(s.ci).toBe(true);
    expect(s.days).toBe(DEFAULTS.days); // untouched
  });
});

describe("urlState round-trip", () => {
  it("serialize → parse preserves non-default state", () => {
    const state = {
      days: 5,
      offset: -6,
      series: ["temp" as const],
      panels: ["precip" as const, "air" as const],
      ci: true,
      extraModels: ["jma_seamless"],
      units: "imperial" as const,
    };
    const round = parseState(new URLSearchParams(serializeState(state).toString()));
    expect(round).toEqual(state);
  });

  it("omits defaults so shared URLs stay short", () => {
    expect(serializeState(DEFAULTS).toString()).toBe("");
  });
});

describe("openMeteoApi placeKey", () => {
  it("is a `lon,lat` string (GeoJSON order), independent of timezone", () => {
    expect(placeKey({ latitude: 43.7064, longitude: -79.3986, timezone: "America/Toronto" })).toBe(
      "-79.3986,43.7064",
    );
  });

  it("is stable per rounded location and distinguishes locations", () => {
    const a = placeKey({ latitude: 43.70641, longitude: -79.39862 });
    const b = placeKey({ latitude: 43.70642, longitude: -79.39861 }); // ~same, rounds equal
    const c = placeKey({ latitude: 45.4215, longitude: -75.6972 }); // Ottawa
    expect(a).toBe(b); // one cache entry per location
    expect(a).not.toBe(c);
  });
});
