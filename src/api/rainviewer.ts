// RainViewer public weather-radar tiles. Free, no API key, permissive CORS —
// so it fits the same keyless, fetch-from-the-browser model as Open-Meteo.
// The index JSON lists observed ("past") + forecast ("nowcast") frames; each
// frame's `path` builds an XYZ tile template that Leaflet consumes directly.
// Docs: https://www.rainviewer.com/api/weather-maps-api.html

const WEATHER_MAPS_URL = "https://api.rainviewer.com/public/weather-maps.json";

export interface RadarFrame {
  /** Frame timestamp, Unix seconds. */
  time: number;
  /** Tile path for this frame, e.g. "/v2/radar/1785033000". */
  path: string;
  /** True for forecast (nowcast) frames, false for observed past frames. */
  nowcast: boolean;
}

export interface RadarIndex {
  /** Tile host, e.g. "https://tilecache.rainviewer.com". */
  host: string;
  /** Past frames followed by nowcast frames, in chronological order. */
  frames: RadarFrame[];
  /** Index of the first nowcast frame (== frames.length when there is none). */
  nowcastStart: number;
  /** When the index was generated, Unix seconds. */
  generated: number;
}

interface RawFrame {
  time: number;
  path: string;
}
interface RawMaps {
  generated: number;
  host: string;
  radar?: { past?: RawFrame[]; nowcast?: RawFrame[] };
}

export async function fetchRadarFrames(signal?: AbortSignal): Promise<RadarIndex> {
  const res = await fetch(WEATHER_MAPS_URL, { signal });
  if (!res.ok) {
    throw new Error(`RainViewer request failed: ${res.status} ${res.statusText}`);
  }
  const raw = (await res.json()) as RawMaps;
  const past = (raw.radar?.past ?? []).map((f) => ({ time: f.time, path: f.path, nowcast: false }));
  const nowcast = (raw.radar?.nowcast ?? []).map((f) => ({ time: f.time, path: f.path, nowcast: true }));
  return {
    host: raw.host,
    frames: [...past, ...nowcast],
    nowcastStart: past.length,
    generated: raw.generated,
  };
}

export interface RadarTileOptions {
  /** Tile size in px (256 or 512). */
  size?: 256 | 512;
  /** RainViewer color scheme 0–8 (4 ≈ intensity green→yellow→red). */
  color?: number;
  /** Smooth the radar data. */
  smooth?: boolean;
  /** Render snow separately (blue). */
  snow?: boolean;
}

/** XYZ tile-URL template for a frame; `{z}/{x}/{y}` are left for Leaflet to fill. */
export function radarTileUrl(host: string, frame: RadarFrame, opts: RadarTileOptions = {}): string {
  const size = opts.size ?? 256;
  const color = opts.color ?? 4;
  const smooth = (opts.smooth ?? true) ? 1 : 0;
  const snow = (opts.snow ?? true) ? 1 : 0;
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}
