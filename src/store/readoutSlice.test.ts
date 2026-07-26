import { describe, expect, it } from "vitest";
import { readoutReducer, openDay, openHover, closeDay, closeHover, type Readout } from "./readoutSlice";

const none: Readout = { kind: "none" };
const day = (date = "2026-07-25"): Readout => ({ kind: "day", date, left: 100 });
const hover: Readout = { kind: "hover" };

describe("readoutSlice — the two readouts are mutually exclusive", () => {
  it("opening the day popover replaces whatever was open", () => {
    expect(readoutReducer(none, openDay({ date: "2026-07-25", left: 100 }))).toEqual(day());
    // Opening a day while the hover tooltip is showing closes the tooltip.
    expect(readoutReducer(hover, openDay({ date: "2026-07-25", left: 100 }))).toEqual(day());
  });

  it("opening the hover tooltip replaces whatever was open", () => {
    expect(readoutReducer(none, openHover())).toEqual(hover);
    // Opening the tooltip while a day popover is up closes the popover.
    expect(readoutReducer(day(), openHover())).toEqual(hover);
  });

  it("each closer clears only its OWN readout (no cross-stomping)", () => {
    // closeDay does nothing while the hover tooltip is up…
    expect(readoutReducer(hover, closeDay())).toEqual(hover);
    // …but clears an open day popover.
    expect(readoutReducer(day(), closeDay())).toEqual(none);

    // closeHover does nothing while a day popover is up…
    expect(readoutReducer(day(), closeHover())).toEqual(day());
    // …but clears an open hover tooltip.
    expect(readoutReducer(hover, closeHover())).toEqual(none);
  });

  it("no-op transitions keep the same state reference (no needless re-render)", () => {
    const h = hover;
    const d = day();
    expect(readoutReducer(h, closeDay())).toBe(h); // closeDay while hovering: no-op
    expect(readoutReducer(h, openHover())).toBe(h); // re-open hover: no-op
    expect(readoutReducer(d, closeHover())).toBe(d); // closeHover while day is open: no-op
  });

  it("the store can never hold both — kind is always exactly one value", () => {
    const states: Readout[] = [
      readoutReducer(none, openDay({ date: "d", left: 0 })),
      readoutReducer(none, openHover()),
      none,
    ];
    for (const s of states) expect(["none", "day", "hover"]).toContain(s.kind);
  });
});
