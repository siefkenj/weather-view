import { describe, expect, it } from "vitest";
import {
  dryAirDensity,
  humidityRatio,
  moistAirEnthalpy,
  moistAirEnthalpyPerVolume,
  saturationVaporPressure,
  wetBulbTemperature,
} from "./psychro";

const P = 1013.25; // sea-level pressure, hPa

describe("saturationVaporPressure", () => {
  it("matches the psychrometric table near 30 °C (~42.4 hPa)", () => {
    expect(saturationVaporPressure(30)).toBeCloseTo(42.4, 0);
  });
  it("is ~6.11 hPa at 0 °C", () => {
    expect(saturationVaporPressure(0)).toBeCloseTo(6.11, 1);
  });
});

describe("humidityRatio", () => {
  it("gives ~13.3 g/kg at 30 °C / 50% RH", () => {
    expect(humidityRatio(30, 50, P) * 1000).toBeCloseTo(13.3, 0);
  });
  it("is zero for perfectly dry air", () => {
    expect(humidityRatio(30, 0, P)).toBe(0);
  });
});

describe("moistAirEnthalpy", () => {
  it("is ~sensible-only for dry air at 30 °C (~30.2 kJ/kg)", () => {
    expect(moistAirEnthalpy(30, 0, P)).toBeCloseTo(30.2, 0);
  });
  it("roughly doubles at 30 °C / 50% RH (~64 kJ/kg)", () => {
    expect(moistAirEnthalpy(30, 50, P)).toBeCloseTo(64, 0);
  });
  it("rises further with humidity — 90% RH exceeds 50% RH", () => {
    expect(moistAirEnthalpy(30, 90, P)).toBeGreaterThan(moistAirEnthalpy(30, 50, P));
  });
});

describe("dryAirDensity", () => {
  it("is ~1.14 kg/m³ for warm moist air (30 °C / 50% RH)", () => {
    expect(dryAirDensity(30, 50, P)).toBeCloseTo(1.14, 1);
  });
  it("is denser when cold — 0 °C exceeds 30 °C", () => {
    expect(dryAirDensity(0, 50, P)).toBeGreaterThan(dryAirDensity(30, 50, P));
  });
});

describe("moistAirEnthalpyPerVolume", () => {
  it("equals per-kg enthalpy times dry-air density (~73 kJ/m³ at 30 °C / 50% RH)", () => {
    const expected = moistAirEnthalpy(30, 50, P) * dryAirDensity(30, 50, P);
    expect(moistAirEnthalpyPerVolume(30, 50, P)).toBeCloseTo(expected, 6);
    expect(moistAirEnthalpyPerVolume(30, 50, P)).toBeCloseTo(73, 0);
  });
  it("rises with humidity — 90% RH exceeds 50% RH", () => {
    expect(moistAirEnthalpyPerVolume(30, 90, P)).toBeGreaterThan(moistAirEnthalpyPerVolume(30, 50, P));
  });
});

describe("wetBulbTemperature", () => {
  it("equals dry bulb at saturation (100% RH)", () => {
    expect(wetBulbTemperature(25, 100, P)).toBeCloseTo(25, 1);
  });
  it("matches the chart at 30 °C / 50% RH (~22 °C)", () => {
    expect(wetBulbTemperature(30, 50, P)).toBeCloseTo(22, 0);
  });
  it("sits between dew point and dry bulb", () => {
    const tw = wetBulbTemperature(30, 50, P);
    expect(tw).toBeLessThan(30);
    expect(tw).toBeGreaterThan(18); // dew point at these conditions is ~18.4 °C
  });
});
