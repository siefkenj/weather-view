import { describe, expect, it } from "vitest";
import { DEFAULT_PLACE, parseSlug, placeLabel, placeToSlug } from "./place";

describe("place slug round-trip", () => {
  it("encodes a place with coordinates", () => {
    expect(placeToSlug(DEFAULT_PLACE)).toBe("toronto-ontario-canada@43.7064,-79.3986");
  });

  it("parses a slug with coordinates back into name + coords", () => {
    const parsed = parseSlug("toronto-ontario-canada@43.7064,-79.3986");
    expect(parsed).toMatchObject({
      name: "Toronto Ontario Canada",
      latitude: 43.7064,
      longitude: -79.3986,
    });
  });

  it("parses a bare label with no coordinates", () => {
    const parsed = parseSlug("paris");
    expect(parsed?.name).toBe("Paris");
    expect(parsed?.latitude).toBeUndefined();
  });

  it("returns null for an empty slug", () => {
    expect(parseSlug("")).toBeNull();
  });
});

describe("placeLabel", () => {
  it("joins the present parts", () => {
    expect(placeLabel(DEFAULT_PLACE)).toBe("Toronto, Ontario, Canada");
    expect(placeLabel({ name: "Nowhere", latitude: 0, longitude: 0 })).toBe("Nowhere");
  });
});
