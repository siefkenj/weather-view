// A Leaflet GridLayer that paints a smooth air-quality field from the sample grid.
// The samples come from a regular n×n lat/lon lattice (api/airQualityGrid), so we
// BILINEARLY interpolate between the four lattice nodes surrounding each pixel — the
// correct interpolant for gridded data. (Inverse-distance weighting, used before,
// is an *exact* interpolator: every node becomes a local extremum, which shows up as
// a regular grid of "hot-spot" bullseyes fading in and out between nodes.)
//
// Lives in the radar lazy chunk (imports Leaflet). New samples repaint the EXISTING
// tile canvases in place rather than calling redraw() (which tears down/rebuilds tile
// DOM nodes and flashes the layer). We also skip the repaint when values are unchanged
// (AQI is hourly, so most timeline steps are a no-op).

import * as L from "leaflet";
import { airFieldColor, airFieldAlpha, type AirMode, type AqiSample } from "../api/airQualityGrid";

const CELL = 4; // px between evaluated samples within a tile (upscaled for smoothness)

interface Node {
  lat: number;
  lon: number;
  aqi: number | null;
}

type TileEntry = { el: HTMLCanvasElement; coords: L.Coords };

const sameGrid = (a: Node[], b: Node[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].aqi !== b[i].aqi || a[i].lat !== b[i].lat || a[i].lon !== b[i].lon) return false;
  }
  return true;
};

export class AqiGridLayer extends L.GridLayer {
  // Row-major (i = lat row south→north, j = lon col west→east) n×n grid of nodes.
  private _grid: Node[] = [];
  private _n = 0;
  private _mode: AirMode = "aqi";

  /** Replace the sample grid (row-major n×n) and repaint in place. */
  setSamples(samples: AqiSample[]): void {
    const next: Node[] = samples.map((s) => ({ lat: s.lat, lon: s.lon, aqi: s.aqi }));
    const n = Math.round(Math.sqrt(next.length));
    if (this._n === n && sameGrid(this._grid, next)) return;
    this._grid = next;
    this._n = n * n === next.length ? n : 0; // only a perfect square is a usable grid
    this._repaintTiles();
  }

  /** Switch the index (AQHI vs AQI) the field is coloured for, and repaint. */
  setMode(mode: AirMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
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
    const n = this._n;
    const grid = this._grid;
    if (!map || n < 2) return;

    const size = this.getTileSize();
    const origin = coords.scaleBy(size);
    // The lattice is a regular lat/lon grid: every column shares a lon (→ one tile-x)
    // and every row shares a lat (→ one tile-y). Project the edges once.
    const colX: number[] = new Array(n);
    for (let j = 0; j < n; j++) colX[j] = map.project([grid[0].lat, grid[j].lon], coords.z).x - origin.x;
    const rowY: number[] = new Array(n); // monotonically DECREASING (north = smaller y)
    for (let i = 0; i < n; i++) rowY[i] = map.project([grid[i * n].lat, grid[0].lon], coords.z).y - origin.y;
    const dxCol = (colX[n - 1] - colX[0]) / (n - 1) || 1; // columns are evenly spaced in x

    const lw = Math.ceil(size.x / CELL) + 1;
    const lh = Math.ceil(size.y / CELL) + 1;
    const off = document.createElement("canvas");
    off.width = lw;
    off.height = lh;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(lw, lh);

    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

    for (let gy = 0; gy < lh; gy++) {
      const py = gy * CELL;
      // Cell row i such that rowY[i] >= py >= rowY[i+1] (rowY decreasing), clamped to
      // the grid at the edges (so tiles beyond the sampled area extend the edge value).
      let i: number;
      if (py >= rowY[0]) i = 0;
      else if (py <= rowY[n - 1]) i = n - 2;
      else {
        i = 0;
        while (i < n - 2 && rowY[i + 1] > py) i++;
      }
      const fy = clamp01((rowY[i] - py) / (rowY[i] - rowY[i + 1] || 1));

      for (let gx = 0; gx < lw; gx++) {
        const px = gx * CELL;
        let j = Math.floor((px - colX[0]) / dxCol);
        j = j < 0 ? 0 : j > n - 2 ? n - 2 : j;
        const fx = clamp01((px - colX[j]) / dxCol);

        // Bilinear over the four corner nodes, skipping any that are null.
        const v00 = grid[i * n + j].aqi;
        const v01 = grid[i * n + j + 1].aqi;
        const v10 = grid[(i + 1) * n + j].aqi;
        const v11 = grid[(i + 1) * n + j + 1].aqi;
        let vsum = 0;
        let wsum = 0;
        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;
        if (v00 != null) {
          vsum += w00 * v00;
          wsum += w00;
        }
        if (v01 != null) {
          vsum += w01 * v01;
          wsum += w01;
        }
        if (v10 != null) {
          vsum += w10 * v10;
          wsum += w10;
        }
        if (v11 != null) {
          vsum += w11 * v11;
          wsum += w11;
        }

        const idx = (gy * lw + gx) * 4;
        if (wsum === 0) {
          img.data[idx + 3] = 0;
          continue;
        }
        const val = vsum / wsum;
        const [r, g, b] = airFieldColor(val, this._mode);
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        // Per-pixel alpha: low-risk air is fully transparent, worse air semi-opaque.
        img.data[idx + 3] = Math.round(airFieldAlpha(val, this._mode) * 255);
      }
    }
    octx.putImageData(img, 0, 0);

    // Bilinear-upscale the low-res field onto the real tile.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, lw, lh, 0, 0, size.x, size.y);
  }
}
