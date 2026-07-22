import { describe, expect, it } from "vitest";
import { parseState } from "./useUrlState";

const parse = (qs: string) => parseState(new URLSearchParams(qs));

describe("parseState", () => {
  it("returns defaults for an empty query string", () => {
    const s = parse("");
    expect(s.view).toBe("forecast");
    expect(s.days).toBe(16);
    expect(s.series).toEqual(["temp", "feels", "dew"]);
    expect(s.panels).toEqual(["precip", "atmo", "air"]);
    expect(s.ci).toBe(false);
    expect(s.units).toBe("metric");
  });

  it("reads explicit visibility state", () => {
    const s = parse("view=history&days=5&layers=temp&panels=precip,air&ci=1&units=imperial&date=2026-07-01");
    expect(s.view).toBe("history");
    expect(s.days).toBe(5);
    expect(s.series).toEqual(["temp"]);
    expect(s.panels).toEqual(["precip", "air"]);
    expect(s.ci).toBe(true);
    expect(s.units).toBe("imperial");
    expect(s.date).toBe("2026-07-01");
  });

  it("clamps days and drops invalid layer tokens", () => {
    expect(parse("days=99").days).toBe(16);
    expect(parse("days=0").days).toBe(1);
    expect(parse("layers=temp,bogus").series).toEqual(["temp"]);
  });
});
