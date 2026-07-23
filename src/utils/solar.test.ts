import { describe, expect, it } from "vitest";
import { daylightIntensity } from "./solar";

describe("daylightIntensity", () => {
  it("is dark at night, brightest near solar noon", () => {
    const time = Array.from({ length: 24 }, (_, h) => `2026-07-22T${String(h).padStart(2, "0")}:00`);
    // Sunrise 06:00, sunset 20:00 → solar noon 13:00, at lat 43.7°.
    const v = daylightIntensity(time, "2026-07-22T06:00", "2026-07-22T20:00", 43.7);
    expect(v).not.toBeNull();
    expect(v![3]).toBe(0); // 3am
    expect(v![22]).toBe(0); // 10pm
    expect(v![13]).toBeGreaterThan(0.7); // near noon
    const peakIdx = v!.indexOf(Math.max(...v!));
    expect(Math.abs(peakIdx - 13)).toBeLessThanOrEqual(1);
  });

  it("returns null when sun times are missing or degenerate", () => {
    expect(daylightIntensity(["2026-01-01T12:00"], undefined, "2026-01-01T20:00", 43)).toBeNull();
    expect(daylightIntensity(["2026-01-01T12:00"], "2026-01-01T20:00", "2026-01-01T06:00", 43)).toBeNull();
  });
});
