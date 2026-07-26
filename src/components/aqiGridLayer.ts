// A Leaflet GridLayer that paints an interpolated air-quality field from a set of
// sample points (inverse-distance weighting). Lives in the radar lazy chunk (it
// imports Leaflet). Per tile we IDW a coarse low-res grid then let the canvas
// bilinear-upscale it, which keeps the field smooth without a pixel-by-pixel pass.
//
// New samples repaint the EXISTING tile canvases in place rather than calling
// redraw() — redraw() tears down and rebuilds every tile DOM node, which flashes
// the layer on each update (very visible while the radar timeline is playing).
// We also skip the repaint entirely when the values are unchanged: radar frames
// step every ~10 min but AQI is hourly, so most frame advances are a no-op.

import * as L from "leaflet";
import { aqiColor, aqiAlpha, type AqiSample } from "../api/airQualityGrid";

const IDW_POWER = 2; // weight ∝ distance^-IDW_POWER
const CELL = 4; // px between IDW samples within a tile (upscaled for smoothness)

interface Sample {
  lat: number;
  lon: number;
  aqi: number;
}

type TileEntry = { el: HTMLCanvasElement; coords: L.Coords };

const sameSamples = (a: Sample[], b: Sample[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].aqi !== b[i].aqi || a[i].lat !== b[i].lat || a[i].lon !== b[i].lon) return false;
  }
  return true;
};

export class AqiGridLayer extends L.GridLayer {
  private _samples: Sample[] = [];

  /** Replace the sample set and repaint in place. Values of null are dropped. */
  setSamples(samples: AqiSample[]): void {
    const next: Sample[] = samples
      .filter((s): s is AqiSample & { aqi: number } => s.aqi != null)
      .map((s) => ({ lat: s.lat, lon: s.lon, aqi: s.aqi }));
    if (sameSamples(this._samples, next)) return; // nothing to redraw → no flash
    this._samples = next;
    this._repaintTiles();
  }

  protected createTile(coords: L.Coords): HTMLElement {
    const size = this.getTileSize();
    const tile = document.createElement("canvas");
    tile.width = size.x;
    tile.height = size.y;
    this._paint(tile, coords);
    return tile;
  }

  /** Redraw the live tile canvases without recreating any DOM (avoids flashing). */
  private _repaintTiles(): void {
    const tiles = (this as unknown as { _tiles?: Record<string, TileEntry> })._tiles;
    if (!tiles) return;
    for (const key of Object.keys(tiles)) {
      const t = tiles[key];
      if (t?.el instanceof HTMLCanvasElement) this._paint(t.el, t.coords);
    }
  }

  private _paint(tile: HTMLCanvasElement, coords: L.Coords): void {
    const ctx = tile.getContext("2d");
    const map = (this as unknown as { _map: L.Map | null })._map;
    if (!ctx) return;
    ctx.clearRect(0, 0, tile.width, tile.height);
    if (!map || this._samples.length === 0) return;

    const size = this.getTileSize();
    // Sample positions in this tile's pixel space (project at the tile's zoom,
    // then shift by the tile origin).
    const origin = coords.scaleBy(size);
    const pts = this._samples.map((s) => {
      const p = map.project([s.lat, s.lon], coords.z);
      return { x: p.x - origin.x, y: p.y - origin.y, aqi: s.aqi };
    });

    // Low-resolution IDW grid, drawn to an offscreen canvas...
    const lw = Math.ceil(size.x / CELL) + 1;
    const lh = Math.ceil(size.y / CELL) + 1;
    const off = document.createElement("canvas");
    off.width = lw;
    off.height = lh;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(lw, lh);

    for (let gy = 0; gy < lh; gy++) {
      for (let gx = 0; gx < lw; gx++) {
        const px = gx * CELL;
        const py = gy * CELL;
        let num = 0;
        let den = 0;
        let exact = -1;
        for (const s of pts) {
          const dx = px - s.x;
          const dy = py - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            exact = s.aqi;
            break;
          }
          const w = 1 / Math.pow(d2, IDW_POWER / 2);
          num += w * s.aqi;
          den += w;
        }
        const val = exact >= 0 ? exact : num / den;
        const [r, g, b] = aqiColor(val);
        const idx = (gy * lw + gx) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        // Per-pixel alpha: "good" air is fully transparent, worse air semi-opaque.
        img.data[idx + 3] = Math.round(aqiAlpha(val) * 255);
      }
    }
    octx.putImageData(img, 0, 0);

    // ...then bilinear-upscale onto the real tile.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, lw, lh, 0, 0, size.x, size.y);
  }
}
