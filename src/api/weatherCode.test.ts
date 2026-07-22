import { describe, expect, it } from "vitest";
import { describeWeather } from "./weatherCode";

describe("describeWeather", () => {
  it("maps known WMO codes", () => {
    expect(describeWeather(0)).toMatchObject({ label: "Clear sky", icon: "clear", severe: false });
    expect(describeWeather(2)).toMatchObject({ icon: "partly-cloudy" });
    expect(describeWeather(95)).toMatchObject({ icon: "thunderstorm", severe: true });
    expect(describeWeather(65).severe).toBe(true);
  });

  it("falls back for unknown codes", () => {
    const d = describeWeather(1234);
    expect(d.label).toBe("Unknown");
    expect(d.code).toBe(1234);
  });
});
