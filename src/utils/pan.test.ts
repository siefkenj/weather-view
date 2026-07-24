import { describe, expect, it } from "vitest";
import { arrowTarget, clampStartIso, shiftStart } from "./pan";

describe("arrowTarget", () => {
  it("advances a full day from a midnight start", () => {
    expect(arrowTarget("2026-07-22T00:00", 1)).toBe("2026-07-23T00:00");
    expect(arrowTarget("2026-07-22T00:00", -1)).toBe("2026-07-21T00:00");
  });

  it("always lands on a midnight and jumps ≥12.5h from a fractional start", () => {
    // From 18:00, the next midnight (+6h) is too close, so it skips to the one after (+30h).
    expect(arrowTarget("2026-07-22T18:00", 1)).toBe("2026-07-24T00:00");
    // Going back from 18:00 lands on the same day's midnight (−18h).
    expect(arrowTarget("2026-07-22T18:00", -1)).toBe("2026-07-22T00:00");
  });

  it("takes the nearer midnight when the fractional start allows a ≥12.5h jump", () => {
    // From 06:00, the next midnight is +18h (≥12.5h) → next day.
    expect(arrowTarget("2026-07-22T06:00", 1)).toBe("2026-07-23T00:00");
    // Back from 06:00 is −6h to today's midnight (<12.5h) → previous day's midnight.
    expect(arrowTarget("2026-07-22T06:00", -1)).toBe("2026-07-21T00:00");
  });
});

describe("shiftStart", () => {
  it("shifts by a fractional number of days", () => {
    expect(shiftStart("2026-07-22T00:00", -0.25)).toBe("2026-07-21T18:00"); // −6h
    expect(shiftStart("2026-07-22T00:00", 1.5)).toBe("2026-07-23T12:00"); // +36h
  });
});

describe("clampStartIso", () => {
  it("clamps between ISO bounds", () => {
    expect(clampStartIso("2026-07-22T06:30", "2026-07-20T00:00", "2026-08-05T00:00")).toBe("2026-07-22T06:30");
    expect(clampStartIso("2026-07-10T00:00", "2026-07-20T00:00", "2026-08-05T00:00")).toBe("2026-07-20T00:00");
    expect(clampStartIso("2026-09-01T00:00", "2026-07-20T00:00", "2026-08-05T00:00")).toBe("2026-08-05T00:00");
  });
});
