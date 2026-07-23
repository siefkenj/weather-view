import { describe, expect, it } from "vitest";
import { aqhiCategory, computeAqhiSeries, formatAqhi } from "./aqhi";

describe("computeAqhiSeries", () => {
  it("matches the ECCC AQHI for clean-air pollutant levels", () => {
    // Toronto sample: O₃ 88, NO₂ 4.2, PM2.5 2.5 µg/m³ → AQHI ≈ 3 (Low).
    const s = computeAqhiSeries({
      ozone: [88, 88, 88],
      nitrogen_dioxide: [4.2, 4.2, 4.2],
      pm2_5: [2.5, 2.5, 2.5],
    });
    expect(s[2]).toBe(3);
  });

  it("never drops below 1 and is NaN when inputs are missing", () => {
    expect(computeAqhiSeries({ ozone: [0], nitrogen_dioxide: [0], pm2_5: [0] })[0]).toBe(1);
    expect(Number.isNaN(computeAqhiSeries({ ozone: [NaN], nitrogen_dioxide: [NaN], pm2_5: [NaN] })[0])).toBe(true);
  });
});

describe("aqhiCategory", () => {
  it("uses the official Canadian category wording", () => {
    expect(aqhiCategory(2).label).toBe("Low health risk");
    expect(aqhiCategory(5).label).toBe("Moderate health risk");
    expect(aqhiCategory(9).label).toBe("High health risk");
    expect(aqhiCategory(11).label).toBe("Very high health risk");
  });
});

describe("formatAqhi", () => {
  it("reports 1–10 and caps higher values at 10+", () => {
    expect(formatAqhi(4)).toBe("4");
    expect(formatAqhi(12)).toBe("10+");
    expect(formatAqhi(null)).toBe("–");
  });
});
