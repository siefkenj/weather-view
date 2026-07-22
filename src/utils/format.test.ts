import { describe, expect, it } from "vitest";
import { formatWeekday, parseLocal } from "./format";

describe("parseLocal", () => {
  // Open-Meteo's daily `time` is date-only ("2026-07-25"). `new Date("2026-07-25")`
  // parses as UTC midnight, which rolls back a day in negative-offset zones and
  // shifted every weekday/date label. Date-only strings must pin to LOCAL midnight.
  it("parses a date-only string as local midnight, not UTC", () => {
    expect(parseLocal("2026-07-25").getTime()).toBe(new Date("2026-07-25T00:00").getTime());
  });

  it("keeps the calendar day of a date-only string in every timezone", () => {
    const d = parseLocal("2026-07-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-based)
    expect(d.getDate()).toBe(25);
  });

  it("still parses time-bearing strings as local wall-clock", () => {
    const d = parseLocal("2026-07-25T13:00");
    expect(d.getHours()).toBe(13);
    expect(d.getDate()).toBe(25);
  });
});

describe("formatWeekday", () => {
  // 2026-07-25 is a Saturday; must not read as Friday (the day before).
  it("names the correct weekday for a date-only key", () => {
    expect(formatWeekday("2026-07-25")).toBe("Sat");
    expect(formatWeekday("2026-07-26")).toBe("Sun");
  });
});
