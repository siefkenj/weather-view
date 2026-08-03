import { describe, expect, it } from "vitest";
import { MODELS, MODEL_IDS, modelLabel } from "./models";

describe("model catalog", () => {
  it("has unique ids and never offers best_match (a meta-model)", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("best_match");
  });

  it("keeps MODEL_IDS in sync with the list", () => {
    expect(MODEL_IDS.size).toBe(MODELS.length);
    for (const m of MODELS) expect(MODEL_IDS.has(m.id)).toBe(true);
  });

  it("labels known ids and falls back to the raw id otherwise", () => {
    expect(modelLabel("ecmwf_ifs025")).toBe("ECMWF IFS");
    expect(modelLabel("some_unknown_model")).toBe("some_unknown_model");
  });
});
