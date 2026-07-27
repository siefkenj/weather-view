// A Leaflet GridLayer that draws a wind vector field. Arrows are laid out on a dense
// screen lattice (independent of the data resolution) and each arrow's vector is
// INTERPOLATED (inverse-distance weighting) from the coarser data samples. So the
// arrows stay dense, fill in where data cells are missing, and never disappear when
// zoomed past the data resolution — there's always something to interpolate from.
//
// Like AqiGridLayer it repaints existing tile canvases in place on new samples (no
// DOM teardown → no flash while the timeline plays).

import * as L from "leaflet";
import { idwVector, type ProjSample, type WindSample } from "../api/windGrid";

const ARROW_SPACING = 40; // px between arrows on screen (denser = more arrows)
const MIN_LEN = 5; // px, arrow length at calm
const MAX_LEN = 30; // px, arrow length at strong wind
const FULL_SPEED = 50; // km/h that maps to MAX_LEN / full opacity
const MARGIN = MAX_LEN; // draw arrows whose centre is just outside a tile too

export class WindLayer extends L.GridLayer {
  private _samples: WindSample[] = [];
  private _color = "#1e6fd0";

  setSamples(samples: WindSample[]): void {
    // Keep every valid sample (including calm) so interpolation has full coverage.
    this._samples = samples.filter((s) => s.speed != null);
    this._repaintTiles();
  }

  /** Theme-aware arrow colour (set from the app theme). */
  setColor(color: string): void {
    if (color === this._color) return;
    this._color = color;
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

  private _repaintTiles(): void {
    const tiles = (this as unknown as { _tiles?: Record<string, { el: HTMLCanvasElement; coords: L.Coords }> })._tiles;
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
    const origin = coords.scaleBy(size);
    // Project data samples into this tile's pixel space (interpolation source).
    const pts: ProjSample[] = this._samples.map((s) => {
      const p = map.project([s.lat, s.lon], coords.z);
      return { x: p.x - origin.x, y: p.y - origin.y, u: s.u, v: s.v };
    });

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1; // thin
    ctx.strokeStyle = this._color;

    // Arrow positions on a global screen lattice (multiples of ARROW_SPACING in
    // world pixels) so arrows stay put across tiles and pans at a given zoom.
    const startX = Math.ceil((origin.x - MARGIN) / ARROW_SPACING) * ARROW_SPACING;
    const startY = Math.ceil((origin.y - MARGIN) / ARROW_SPACING) * ARROW_SPACING;
    for (let wx = startX; wx <= origin.x + size.x + MARGIN; wx += ARROW_SPACING) {
      for (let wy = startY; wy <= origin.y + size.y + MARGIN; wy += ARROW_SPACING) {
        const x = wx - origin.x;
        const y = wy - origin.y;
        const wind = idwVector(pts, x, y);
        if (!wind) continue;
        const mag = Math.hypot(wind.u, wind.v);
        if (mag < 1e-6) continue;

        const sx = wind.u / mag;
        const sy = -wind.v / mag; // north = -y on screen
        // Length scales with speed (√ so mid-range winds stay distinguishable).
        const t = Math.min(1, Math.sqrt(mag / FULL_SPEED));
        const len = MIN_LEN + (MAX_LEN - MIN_LEN) * t;
        const head = 2.5 + 2.5 * t;
        ctx.globalAlpha = 0.55 + 0.4 * t;

        const hx = (sx * len) / 2;
        const hy = (sy * len) / 2;
        const tipX = x + hx;
        const tipY = y + hy;
        const ang = Math.atan2(sy, sx);
        ctx.beginPath();
        ctx.moveTo(x - hx, y - hy);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - head * Math.cos(ang - Math.PI / 6), tipY - head * Math.sin(ang - Math.PI / 6));
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - head * Math.cos(ang + Math.PI / 6), tipY - head * Math.sin(ang + Math.PI / 6));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
