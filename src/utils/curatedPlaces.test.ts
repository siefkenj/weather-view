import { describe, expect, it } from "vitest";
import { curatedMatches } from "./curatedPlaces";

const names = (q: string) => curatedMatches(q).map((p) => p.name);

describe("curatedMatches", () => {
  it("finds the requested Ontario places the geocoder misses", () => {
    expect(names("university of toronto")).toContain("University of Toronto");
    expect(names("niagara glen")).toContain("Niagara Glen Nature Reserve");
    expect(names("mount nemo")).toContain("Mount Nemo Conservation Area");
    expect(names("rattlesnake point")).toContain("Rattlesnake Point Conservation Area");
    expect(names("niagara on the lake")).toContain("Niagara-on-the-Lake");
    expect(names("rattlesnake")).toContain("Rattlesnake Point Conservation Area");
  });

  it("matches on hiking-spot aliases too", () => {
    expect(names("grotto")).toContain("Bruce Peninsula National Park");
    expect(names("bruce trail")).toContain("Rattlesnake Point Conservation Area");
  });

  it("returns Ontario/Canada entries with the correct timezone", () => {
    const p = curatedMatches("mount nemo")[0];
    expect(p.admin1).toBe("Ontario");
    expect(p.country).toBe("Canada");
    expect(p.timezone).toBe("America/Toronto");
  });

  it("ignores empty or too-short queries", () => {
    expect(curatedMatches("")).toEqual([]);
    expect(curatedMatches("a")).toEqual([]);
  });
});
