import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRecentPlace, clearRecentPlaces, getRecentPlaces } from "./recentPlaces";
import type { Place } from "../api/types";

const P = (name: string, lat: number, lon: number, admin1?: string, country?: string): Place => ({
  name,
  latitude: lat,
  longitude: lon,
  admin1,
  country,
});

beforeEach(() => clearRecentPlaces());
afterEach(() => localStorage.clear());

describe("recentPlaces", () => {
  it("starts empty", () => {
    expect(getRecentPlaces()).toEqual([]);
  });

  it("prepends most-recent first and persists across reads", () => {
    addRecentPlace(P("A", 1, 1));
    addRecentPlace(P("B", 2, 2));
    expect(getRecentPlaces().map((p) => p.name)).toEqual(["B", "A"]);
  });

  it("dedupes by slug, moving the repeat back to the front", () => {
    addRecentPlace(P("A", 1, 1));
    addRecentPlace(P("B", 2, 2));
    addRecentPlace(P("A", 1, 1));
    expect(getRecentPlaces().map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("treats the same name at different coordinates as distinct places", () => {
    addRecentPlace(P("Springfield", 39.8, -89.6));
    addRecentPlace(P("Springfield", 42.1, -72.6));
    expect(getRecentPlaces()).toHaveLength(2);
  });

  it("caps the stored list at 8, keeping the newest", () => {
    for (let i = 0; i < 12; i++) addRecentPlace(P("C" + i, i, i));
    const r = getRecentPlaces();
    expect(r).toHaveLength(8);
    expect(r[0].name).toBe("C11");
    expect(r.map((p) => p.name)).not.toContain("C0");
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("wv:recents:v1", "{not json");
    expect(getRecentPlaces()).toEqual([]);
  });

  it("filters out non-place junk", () => {
    localStorage.setItem("wv:recents:v1", JSON.stringify([{ foo: 1 }, P("Ok", 5, 5)]));
    expect(getRecentPlaces().map((p) => p.name)).toEqual(["Ok"]);
  });

  it("clear empties the list", () => {
    addRecentPlace(P("A", 1, 1));
    clearRecentPlaces();
    expect(getRecentPlaces()).toEqual([]);
  });
});
