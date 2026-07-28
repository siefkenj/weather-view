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

  it("uses a centred window — a spike bumps the hour before and after equally (no lag)", () => {
    // Ozone spike at index 2; a centred 3-h average lifts indices 1 & 3 symmetrically.
    const s = computeAqhiSeries({
      ozone: [10, 10, 200, 10, 10],
      nitrogen_dioxide: [5, 5, 5, 5, 5],
      pm2_5: [3, 3, 3, 3, 3],
    });
    expect(s[1]).toBeGreaterThan(s[0]); // raised the hour BEFORE the spike (trailing can't)
    expect(s[1]).toBe(s[3]); // symmetric around the spike, not shifted later
    expect(s[4]).toBe(s[0]); // two hours after is back to baseline
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
