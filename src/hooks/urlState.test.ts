import { describe, expect, it } from "vitest";
import { parseState } from "./useUrlState";

const parse = (qs: string) => parseState(new URLSearchParams(qs));

describe("parseState", () => {
  it("returns defaults for an empty query string", () => {
    const s = parse("");
    expect(s.days).toBe(10);
    expect(s.offset).toBe(0);
    expect(s.series).toEqual(["temp", "feels", "dew"]);
    expect(s.panels).toEqual(["precip", "atmo", "air"]);
    expect(s.ci).toBe(false);
    expect(s.units).toBe("metric");
  });

  it("reads explicit visibility state", () => {
    const s = parse("days=5&offset=-6&layers=temp&panels=precip,air&ci=1&units=imperial");
    expect(s.days).toBe(5);
    expect(s.offset).toBe(-6);
    expect(s.series).toEqual(["temp"]);
    expect(s.panels).toEqual(["precip", "air"]);
    expect(s.ci).toBe(true);
    expect(s.units).toBe("imperial");
  });

  it("clamps days and offset and drops invalid layer tokens", () => {
    expect(parse("days=99").days).toBe(16);
    expect(parse("days=0").days).toBe(1);
    expect(parse("offset=-999").offset).toBe(-92); // -MAX_PAST_DAYS
    expect(parse("offset=999").offset).toBe(15); // MAX_FORECAST_DAYS - 1
    expect(parse("layers=temp,bogus").series).toEqual(["temp"]);
  });
});
