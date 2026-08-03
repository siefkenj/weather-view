import { describe, expect, it } from "vitest";
import { buildPrecipMap, pickNearestStation, utcToZonedHourIso } from "./eccc";

describe("utcToZonedHourIso", () => {
  it("converts UTC to the DST-aware local hour (summer → EDT, UTC-4)", () => {
    expect(utcToZonedHourIso("2026-08-02T05:00:00", "America/Toronto")).toBe("2026-08-02T01:00");
  });
  it("uses standard time in winter (EST, UTC-5)", () => {
    expect(utcToZonedHourIso("2026-01-15T05:00:00", "America/Toronto")).toBe("2026-01-15T00:00");
  });
});

describe("pickNearestStation", () => {
  const near = { latitude: 43.65, longitude: -79.38 };
  const stn = (id: number, name: string, lon: number, lat: number, hourly: string, last: string) => ({
    geometry: { coordinates: [lon, lat] as [number, number] },
    properties: { STN_ID: id, STATION_NAME: name, HAS_HOURLY_DATA: hourly, HLY_LAST_DATE: last },
  });

  it("picks the nearest ACTIVE hourly station, skipping closed and daily-only ones", () => {
    const features = [
      stn(1, "Far active", -79.0, 43.7, "Y", "2026-08-01 12:00:00"),
      stn(2, "Near active", -79.4, 43.65, "Y", "2026-08-01 12:00:00"),
      stn(3, "Nearest but closed", -79.39, 43.66, "Y", "2015-05-21 13:00:00"),
      stn(4, "Near daily-only", -79.4, 43.66, "N", ""),
    ];
    const best = pickNearestStation(features, near.latitude, near.longitude, "2026-06-01");
    expect(best?.stnId).toBe(2);
    expect(best?.distanceKm).toBeLessThan(10);
  });

  it("returns null when nothing active is in range", () => {
    const features = [stn(3, "Closed", -79.39, 43.66, "Y", "2015-05-21 13:00:00")];
    expect(pickNearestStation(features, near.latitude, near.longitude, "2026-06-01")).toBeNull();
  });
});

describe("buildPrecipMap", () => {
  it("keys measured precip by local-ISO hour and skips null/missing values", () => {
    const features = [
      { properties: { UTC_DATE: "2026-08-02T05:00:00", PRECIP_AMOUNT: 0.1 } },
      { properties: { UTC_DATE: "2026-08-02T06:00:00", PRECIP_AMOUNT: 0 } },
      { properties: { UTC_DATE: "2026-08-02T07:00:00", PRECIP_AMOUNT: null } },
      { properties: { UTC_DATE: "2026-08-02T08:00:00" } }, // no PRECIP field
    ];
    const map = buildPrecipMap(features, "America/Toronto");
    expect(map["2026-08-02T01:00"]).toBe(0.1);
    expect(map["2026-08-02T02:00"]).toBe(0); // a real zero is kept
    expect(map["2026-08-02T03:00"]).toBeUndefined(); // null skipped
    expect(map["2026-08-02T04:00"]).toBeUndefined(); // missing skipped
  });
});
