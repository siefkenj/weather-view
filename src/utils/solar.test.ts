import { describe, expect, it } from "vitest";
import { daylightBrightnessStops, perceivedBrightness, solarSinElevation } from "./solar";

const DEG = Math.PI / 180;

describe("solarSinElevation", () => {
  it("is negative (below horizon) at night, positive and peaking near solar noon", () => {
    const time = Array.from({ length: 24 }, (_, h) => `2026-07-22T${String(h).padStart(2, "0")}:00`);
    // Sunrise 06:00, sunset 20:00 → solar noon 13:00, at lat 43.7°.
    const v = solarSinElevation(time, "2026-07-22T06:00", "2026-07-22T20:00", 43.7);
    expect(v).not.toBeNull();
    expect(v![3]).toBeLessThan(0); // 3am — sun below the horizon (now signed, not clamped)
    expect(v![22]).toBeLessThan(0); // 10pm
    expect(v![13]).toBeGreaterThan(0.7); // near noon
    const peakIdx = v!.indexOf(Math.max(...v!));
    expect(Math.abs(peakIdx - 13)).toBeLessThanOrEqual(1);
  });

  it("returns null when sun times are missing or degenerate", () => {
    expect(solarSinElevation(["2026-01-01T12:00"], undefined, "2026-01-01T20:00", 43)).toBeNull();
    expect(solarSinElevation(["2026-01-01T12:00"], "2026-01-01T20:00", "2026-01-01T06:00", 43)).toBeNull();
  });
});

describe("perceivedBrightness", () => {
  it("saturates near 1 for a high sun (adaptation keeps daytime bright)", () => {
    expect(perceivedBrightness(Math.sin(60 * DEG))).toBeGreaterThan(0.99);
  });

  it("is 0.5 at the semi-saturation point (end of civil twilight, sun −6°)", () => {
    expect(perceivedBrightness(Math.sin(-6 * DEG))).toBeCloseTo(0.5, 2);
  });

  it("collapses toward 0 by astronomical night (sun −18°)", () => {
    expect(perceivedBrightness(Math.sin(-18 * DEG))).toBeLessThan(0.05);
  });

  it("holds far brighter than the physical light at sunset (elevation 0°)", () => {
    // Physical light at the horizon is ~2% of overhead, but perceived stays high.
    expect(perceivedBrightness(0)).toBeGreaterThan(0.8);
  });

  it("is monotonically increasing in elevation", () => {
    const samples = [-0.4, -0.2, -0.1, 0, 0.1, 0.3, 0.6, 0.9];
    for (let i = 1; i < samples.length; i++) {
      expect(perceivedBrightness(samples[i])).toBeGreaterThan(perceivedBrightness(samples[i - 1]));
    }
  });

  it("falls off sharply through twilight — the sudden 'night' transition", () => {
    // Sunset → civil dusk loses far more perceived brightness per degree than the
    // bright daytime range does: the knee is where night falls fast.
    const duskDrop = perceivedBrightness(Math.sin(0)) - perceivedBrightness(Math.sin(-6 * DEG));
    const dayDrop = perceivedBrightness(Math.sin(30 * DEG)) - perceivedBrightness(Math.sin(24 * DEG));
    expect(duskDrop).toBeGreaterThan(dayDrop * 10);
  });
});

describe("daylightBrightnessStops", () => {
  const time = Array.from({ length: 24 }, (_, h) => `2026-07-22T${String(h).padStart(2, "0")}:00`);

  it("supersamples: returns samples+1 stops spanning 0–100% with brightness in [0,1]", () => {
    const stops = daylightBrightnessStops(time, "2026-07-22T06:00", "2026-07-22T20:00", 43.7, 64);
    expect(stops).not.toBeNull();
    expect(stops!).toHaveLength(65);
    expect(stops![0].offset).toBe(0);
    expect(stops![64].offset).toBe(100);
    for (const s of stops!) {
      expect(s.brightness).toBeGreaterThanOrEqual(0);
      expect(s.brightness).toBeLessThanOrEqual(1);
    }
  });

  it("is bright around midday and dark overnight", () => {
    const stops = daylightBrightnessStops(time, "2026-07-22T06:00", "2026-07-22T20:00", 43.7, 48)!;
    const at = (frac: number) => stops[Math.round(frac * (stops.length - 1))].brightness;
    expect(at(13 / 23)).toBeGreaterThan(0.9); // ~1pm
    expect(at(3 / 23)).toBeLessThan(0.1); // ~3am
  });

  it("returns null on degenerate geometry", () => {
    expect(daylightBrightnessStops(time, undefined, "2026-07-22T20:00", 43.7)).toBeNull();
  });
});
