import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRadarFrames, radarTileUrl, type RadarFrame } from "./rainviewer";

afterEach(() => vi.unstubAllGlobals());

const frame: RadarFrame = { time: 1785033000, path: "/v2/radar/abc", nowcast: false };

describe("radarTileUrl", () => {
  it("builds an XYZ template with sensible defaults", () => {
    expect(radarTileUrl("https://host", frame)).toBe(
      "https://host/v2/radar/abc/256/{z}/{x}/{y}/4/1_1.png",
    );
  });
  it("honours size/color/smooth/snow options", () => {
    expect(radarTileUrl("https://host", frame, { size: 512, color: 2, smooth: false, snow: false })).toBe(
      "https://host/v2/radar/abc/512/{z}/{x}/{y}/2/0_0.png",
    );
  });
});

describe("fetchRadarFrames", () => {
  it("flattens past + nowcast and marks the nowcast boundary", async () => {
    const raw = {
      generated: 100,
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [
          { time: 1, path: "/a" },
          { time: 2, path: "/b" },
        ],
        nowcast: [{ time: 3, path: "/c" }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => raw })));

    const idx = await fetchRadarFrames();
    expect(idx.host).toBe("https://tilecache.rainviewer.com");
    expect(idx.frames.map((f) => f.nowcast)).toEqual([false, false, true]);
    expect(idx.nowcastStart).toBe(2);
    expect(idx.frames).toHaveLength(3);
  });

  it("tolerates a missing radar block", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ generated: 0, host: "h" }) })));
    const idx = await fetchRadarFrames();
    expect(idx.frames).toEqual([]);
    expect(idx.nowcastStart).toBe(0);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, statusText: "Service Unavailable" })));
    await expect(fetchRadarFrames()).rejects.toThrow(/503/);
  });
});
