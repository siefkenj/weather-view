import { describe, expect, it } from "vitest";
import { parseState } from "../store/urlState";

const parse = (qs: string) => parseState(new URLSearchParams(qs));

describe("parseState", () => {
  it("returns defaults for an empty query string", () => {
    const s = parse("");
    expect(s.days).toBe(10);
    expect(s.viewStart).toBeNull();
    expect(s.series).toEqual(["temp", "feels"]);
    expect(s.panels).toEqual(["precip", "atmo", "air"]);
    expect(s.ci).toBe(false);
    expect(s.units).toBe("metric");
  });

  it("reads explicit visibility state", () => {
    const s = parse("days=5&layers=temp&panels=precip,air&ci=1&units=imperial");
    expect(s.days).toBe(5);
    expect(s.series).toEqual(["temp"]);
    expect(s.panels).toEqual(["precip", "air"]);
    expect(s.ci).toBe(true);
    expect(s.units).toBe("imperial");
  });

  it("clamps days, ignores any `start` param, and drops invalid tokens", () => {
    expect(parse("days=99").days).toBe(16);
    expect(parse("days=0").days).toBe(1);
    // viewStart is session-only pan state — never read from the URL.
    expect(parse("start=2026-07-20T06:30").viewStart).toBeNull();
    expect(parse("layers=temp,bogus").series).toEqual(["temp"]);
  });
});
