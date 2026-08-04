import { describe, expect, it } from "vitest";
import { formatWindSpeed, WIND_ARROW_TITLE, windArrowRotation, windArrowSpan, windCompass } from "./wind";

describe("windCompass", () => {
  it("maps cardinal and intercardinal bearings", () => {
    expect(windCompass(0)).toBe("N");
    expect(windCompass(90)).toBe("E");
    expect(windCompass(180)).toBe("S");
    expect(windCompass(270)).toBe("W");
    expect(windCompass(45)).toBe("NE");
    expect(windCompass(315)).toBe("NW");
  });

  it("snaps to the nearest of 16 points and wraps at 360", () => {
    expect(windCompass(22)).toBe("NNE");
    expect(windCompass(360)).toBe("N");
    expect(windCompass(348.75)).toBe("N"); // 348.75 rounds up past 360 → N
    expect(windCompass(-45)).toBe("NW"); // negative bearings normalise
  });

  it("returns empty for missing bearings", () => {
    expect(windCompass(null)).toBe("");
    expect(windCompass(undefined)).toBe("");
    expect(windCompass(NaN)).toBe("");
  });
});

describe("windArrowRotation", () => {
  it("points the way the wind is blowing (deg + 180), offset from the glyph's east base", () => {
    // ⟶ points east (90°); rotation = (FROM bearing + 180) − 90 = bearing + 90.
    expect(windArrowRotation(90)).toBe(180); // wind FROM east → blowing west
    expect(windArrowRotation(0)).toBe(90); // FROM north → blowing south
    expect(windArrowRotation(180)).toBe(270); // FROM south → blowing north
    expect(windArrowRotation(202.5)).toBe(292.5);
  });

  it("normalises out-of-range bearings and blanks on unknown", () => {
    expect(windArrowRotation(360)).toBe(90); // same as 0
    expect(windArrowRotation(-90)).toBe(0);
    expect(windArrowRotation(null)).toBeNull();
    expect(windArrowRotation(NaN)).toBeNull();
  });
});

describe("windArrowSpan", () => {
  it("emits a span rotated the way the wind is blowing, with the convention as title", () => {
    const html = windArrowSpan(202.5);
    expect(html).toContain("rotate(292.5deg)");
    expect(html).toContain("⟶");
    expect(html).toContain("display:inline-block");
    expect(html).toContain(`title="${WIND_ARROW_TITLE}"`);
  });

  it("applies a colour when given and is empty for unknown bearings", () => {
    expect(windArrowSpan(90, { color: "#fff" })).toContain("color:#fff");
    expect(windArrowSpan(null)).toBe("");
    expect(windArrowSpan(NaN)).toBe("");
  });
});

describe("formatWindSpeed", () => {
  it("rounds the speed and always uses km/h", () => {
    expect(formatWindSpeed(12.4)).toBe("12 km/h");
    expect(formatWindSpeed(0)).toBe("0 km/h");
  });

  it("shows a dash when there's no speed", () => {
    expect(formatWindSpeed(null)).toBe("–");
    expect(formatWindSpeed(undefined)).toBe("–");
    expect(formatWindSpeed(NaN)).toBe("–");
  });
});
