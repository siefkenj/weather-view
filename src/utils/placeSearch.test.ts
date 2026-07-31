import { describe, expect, it } from "vitest";
import { normalize, queryCandidates, rankPlaces, tokenize } from "./placeSearch";
import type { GeoLocation } from "../api/types";

let idc = 0;
const g = (
  name: string,
  admin1?: string,
  country?: string,
  countryCode?: string,
  population?: number,
): GeoLocation => ({
  id: ++idc,
  name,
  latitude: 0,
  longitude: 0,
  admin1,
  country,
  country_code: countryCode,
  population,
});

const LONDONS = [
  g("London", "England", "United Kingdom", "GB", 8961989),
  g("London", "Ontario", "Canada", "CA", 346765),
  g("London", "Kentucky", "United States", "US", 8000),
];
const names = (rs: GeoLocation[]) => rs.map((r) => `${r.name}/${r.admin1}`);

describe("normalize / tokenize", () => {
  it("treats every kind of separator the same", () => {
    for (const q of ["London, ON", "London ON", "London,ON", "London/ON", "London - ON"]) {
      expect(tokenize(q)).toEqual(["london", "on"]);
    }
  });

  it("strips accents and case", () => {
    expect(normalize("Montréal")).toBe("montreal");
    expect(tokenize("  ST. CATHARINES  ")).toEqual(["st", "catharines"]);
  });

  it("keeps non-Latin scripts intact", () => {
    expect(tokenize("東京")).toEqual(["東京"]);
    expect(tokenize("Москва, Россия")).toEqual(["москва", "россия"]);
  });
});

describe("queryCandidates", () => {
  it("asks for the whole query and its first word", () => {
    // The whole query keeps the user's punctuation — the geocoder needs it.
    expect(queryCandidates("st. catharines")).toEqual(["st. catharines", "st"]);
    expect(queryCandidates("London, Ontario")).toEqual(["London, Ontario", "london"]);
  });

  it("collapses to one request for a single word", () => {
    expect(queryCandidates("Toronto")).toEqual(["Toronto"]);
  });

  it("recovers a first word even without spaces", () => {
    // "london,ontario" would otherwise be one unusable token.
    expect(queryCandidates("london,ontario")).toEqual(["london,ontario", "london"]);
  });

  it("ignores queries below the minimum length", () => {
    expect(queryCandidates("a")).toEqual([]);
    expect(queryCandidates("  ,  ")).toEqual([]);
  });
});

describe("rankPlaces", () => {
  it("keeps every match for a bare name, most populous first", () => {
    expect(names(rankPlaces(LONDONS, "London"))).toEqual([
      "London/England",
      "London/Ontario",
      "London/Kentucky",
    ]);
  });

  it("narrows by a trailing region, however it is punctuated", () => {
    for (const q of ["London, Ontario", "London Ontario", "london,ontario"]) {
      expect(names(rankPlaces(LONDONS, q))).toEqual(["London/Ontario"]);
    }
  });

  it("narrows by country, country code, and postal abbreviation", () => {
    expect(names(rankPlaces(LONDONS, "London Canada"))).toEqual(["London/Ontario"]);
    expect(names(rankPlaces(LONDONS, "London CA"))).toEqual(["London/Ontario"]);
    expect(names(rankPlaces(LONDONS, "London ON"))).toEqual(["London/Ontario"]);
    expect(names(rankPlaces(LONDONS, "London UK"))).toEqual(["London/England"]);
  });

  it("accepts a partially typed qualifier", () => {
    expect(names(rankPlaces(LONDONS, "London ont"))).toEqual(["London/Ontario"]);
    expect(names(rankPlaces(LONDONS, "London engl"))).toEqual(["London/England"]);
  });

  it("ranks an exact whole-query name above places that merely contain the word", () => {
    const results = [
      g("York", "Nebraska", "United States", "US", 8000),
      g("New York", "New York", "United States", "US", 8175133),
      g("Newark", "New Jersey", "United States", "US", 311549),
    ];
    // "New York" is the whole query → first, even though all three survive filtering
    // only if they match; York/Newark lack a "new"/"york" pair so they drop out.
    expect(names(rankPlaces(results, "New York"))[0]).toBe("New York/New York");
  });

  it("puts the plainly-named place above a bigger one that merely extends the name", () => {
    const results = [
      g("Vancouver Island", "British Columbia", "Canada", "CA", 870000),
      g("Vancouver", "British Columbia", "Canada", "CA", 600000),
    ];
    // The island is more populous, but "vancouver bc" names the city exactly.
    expect(names(rankPlaces(results, "vancouver bc"))[0]).toBe("Vancouver/British Columbia");
  });

  it("ranks a name that leads the query above an incidental match", () => {
    const results = [
      g("Ontario", "California", "United States", "US", 175000),
      g("London", "Ontario", "Canada", "CA", 346765),
    ];
    // Query leads with "london", so London/Ontario outranks Ontario/California even
    // though both contain every token.
    expect(names(rankPlaces(results, "london ontario"))[0]).toBe("London/Ontario");
  });

  it("returns nothing when a qualifier matches no result", () => {
    expect(rankPlaces(LONDONS, "London Australia")).toEqual([]);
  });

  it("does not match mid-word noise", () => {
    expect(rankPlaces(LONDONS, "ondon")).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => g("Springfield", `Region ${i}`, "United States", "US", i));
    expect(rankPlaces(many, "Springfield")).toHaveLength(8);
    expect(rankPlaces(many, "Springfield", 3)).toHaveLength(3);
  });
});
