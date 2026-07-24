import { describe, expect, it } from "vitest";
import { dayList, windowByDays, windowByTime, type HourlyPoint } from "./series";

/** Build an HourlyPoint spanning `days` days from 2026-07-20, hourly. */
function sample(days = 5): HourlyPoint {
  const time: string[] = [];
  for (let d = 0; d < days; d++) {
    const day = String(20 + d).padStart(2, "0");
    for (let hh = 0; hh < 24; hh++) time.push(`2026-07-${day}T${String(hh).padStart(2, "0")}:00`);
  }
  const fill = time.map((_, i) => i);
  return {
    time,
    temperature: fill,
    apparent: fill,
    dewPoint: fill,
    precipitation: fill,
    precipProbability: fill,
    humidity: fill,
    cloudCover: fill,
    pressure: fill,
    radiation: fill,
  };
}

describe("dayList", () => {
  it("returns the distinct local day keys in order", () => {
    expect(dayList(sample(3))).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });
});

describe("windowByDays", () => {
  it("slices an inclusive range of whole days", () => {
    const win = windowByDays(sample(5), "2026-07-21", "2026-07-22");
    expect(win.time).toHaveLength(48);
    expect(win.time[0]).toBe("2026-07-21T00:00");
    expect(win.time[win.time.length - 1]).toBe("2026-07-22T23:00");
  });

  it("clamps to the available data at the end of the range", () => {
    const win = windowByDays(sample(3), "2026-07-22", "2026-07-30");
    expect(win.time).toHaveLength(24);
    expect(win.time[0]).toBe("2026-07-22T00:00");
  });

  it("returns an empty window when the start is past the data", () => {
    expect(windowByDays(sample(2), "2026-08-01", "2026-08-05").time).toHaveLength(0);
  });
});

describe("windowByTime", () => {
  it("slices exactly `days` days from a midnight start", () => {
    const win = windowByTime(sample(5), "2026-07-21T00:00", 2);
    expect(win.time).toHaveLength(48);
    expect(win.time[0]).toBe("2026-07-21T00:00");
    expect(win.time[win.time.length - 1]).toBe("2026-07-22T23:00");
  });

  it("honours a fractional (continuous) start", () => {
    // Starts at 06:00 on the 21st and runs 1 day → [21T06:00, 22T06:00).
    const win = windowByTime(sample(5), "2026-07-21T06:00", 1);
    expect(win.time[0]).toBe("2026-07-21T06:00");
    expect(win.time[win.time.length - 1]).toBe("2026-07-22T05:00");
    expect(win.time).toHaveLength(24);
  });

  it("clamps to the data at the end of the range", () => {
    const win = windowByTime(sample(3), "2026-07-22T00:00", 5);
    expect(win.time).toHaveLength(24);
    expect(win.time[0]).toBe("2026-07-22T00:00");
  });
});
