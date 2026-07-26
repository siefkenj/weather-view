// Precipitation-radar map. Lazy-loaded (Leaflet + its CSS live in this chunk, off
// the main bundle). A CARTO base layer tracks the app theme; RainViewer radar
// frames animate on top with a play/scrub timeline. Default-exported for React.lazy.

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRadarFramesQuery } from "../store/openMeteoApi";
import { radarTileUrl, type RadarIndex } from "../api/rainviewer";
import { AqiGridLayer } from "./aqiGridLayer";
import { fetchAqiGrid, sampleAqiGridAt, AQI_LEGEND, type AqiGrid } from "../api/airQualityGrid";
import { useTheme } from "../hooks/useTheme";
import type { Theme } from "../hooks/useTheme";
import { useDashboardState } from "../hooks/useUrlState";
import type { Place } from "../api/types";

const CARTO_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/attributions">CARTO</a>';
const RADAR_ATTR = 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>';
const RADAR_OPACITY = 0.72;
const AQI_REFETCH_MS = 400;
// Default view spans ~80 km across (fit to the map's shorter axis).
const DEFAULT_REGION_M = 80_000;
const FRAME_MS = 500;
const PRELOAD_TIMEOUT_MS = 2500;
// RainViewer serves radar tiles only up to ~z7; beyond that its server returns a
// "zoom level not supported" placeholder. maxNativeZoom keeps us on z7 tiles and
// lets Leaflet upscale them for closer zooms instead of requesting missing ones.
const RADAR_MAX_NATIVE_ZOOM = 7;

const cartoUrl = (theme: Theme) =>
  `https://{s}.basemaps.cartocdn.com/${theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`;

const formatClock = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * Ensure a frame's tile layer exists (created at opacity 0 so its tiles start
 * loading without a flash) and resolve once those tiles are on screen — so the
 * animation can preload the NEXT frame before revealing it. A safety timeout
 * keeps the loop moving if a `load` event never arrives.
 */
function ensureRadarLayer(
  map: L.Map,
  data: RadarIndex,
  layers: Map<number, L.TileLayer>,
  loaded: Set<number>,
  i: number,
): Promise<void> {
  const frame = data.frames[i];
  if (!frame) return Promise.resolve();
  if (loaded.has(frame.time)) return Promise.resolve();

  let layer = layers.get(frame.time);
  if (!layer) {
    layer = L.tileLayer(radarTileUrl(data.host, frame), {
      opacity: 0,
      maxZoom: 18,
      maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
      attribution: RADAR_ATTR,
      pane: "radar",
    });
    layer.addTo(map);
    layers.set(frame.time, layer);
  }
  const l = layer;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      loaded.add(frame.time);
      resolve();
    };
    l.once("load", done);
    window.setTimeout(done, PRELOAD_TIMEOUT_MS);
  });
}

export default function RadarView({ place }: { place: Place }) {
  const { theme } = useTheme();
  const { state, setZoom } = useDashboardState();
  const radar = useRadarFramesQuery(undefined, {
    pollingInterval: 5 * 60 * 1000,
    skipPollingIfUnfocused: true,
  });
  const data = radar.data;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const layersRef = useRef<Map<number, L.TileLayer>>(new Map());
  const loadedRef = useRef<Set<number>>(new Set());
  const aqiLayerRef = useRef<AqiGridLayer | null>(null);
  const indexRef = useRef(0);
  // Latest values read inside the once-only init effect without re-subscribing.
  const zoomRef = useRef(state.zoom);
  zoomRef.current = state.zoom;
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [radarOn, setRadarOn] = useState(true);
  const [aqiOn, setAqiOn] = useState(false);
  const [aqiGrid, setAqiGrid] = useState<AqiGrid | null>(null);
  const [aqiError, setAqiError] = useState(false);
  const frameCount = data?.frames.length ?? 0;
  // Timestamp of the frame the timeline is on — the air-quality field follows it.
  const activeFrameTime = data?.frames[index]?.time ?? null;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Init the map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const layers = layersRef.current;
    const center = L.latLng(place.latitude, place.longitude);
    // zoomSnap 0.25 lets the initial fit land close to an 80 km span instead of
    // snapping to a coarse integer zoom; buttons/keyboard still step by 1.
    const map = L.map(el, { center, zoom: 8, worldCopyJump: true, zoomSnap: 0.25, zoomDelta: 1 });
    mapRef.current = map;
    // Explicit stack above the base map: air-quality field, then radar on top.
    map.createPane("aqi").style.zIndex = "240";
    map.createPane("radar").style.zIndex = "250";
    const aqiLayer = new AqiGridLayer({ pane: "aqi" });
    aqiLayerRef.current = aqiLayer;
    L.circleMarker([place.latitude, place.longitude], {
      radius: 5,
      weight: 2,
      color: "#111827",
      fillColor: "#ffffff",
      fillOpacity: 1,
    }).addTo(map);
    const t = window.setTimeout(() => {
      map.invalidateSize();
      // Restore the zoom from Redux if we have one; otherwise fit the default
      // ~80 km region (needs the container's final size to map to a zoom).
      const storedZoom = zoomRef.current;
      if (storedZoom != null) map.setView(center, storedZoom, { animate: false });
      else map.fitBounds(center.toBounds(DEFAULT_REGION_M), { animate: false });
    }, 0);
    // Persist zoom changes back to Redux (session-only; not written to the URL).
    const onZoom = () => setZoomRef.current(map.getZoom());
    map.on("zoomend", onZoom);
    return () => {
      window.clearTimeout(t);
      map.off("zoomend", onZoom);
      map.remove();
      mapRef.current = null;
      baseRef.current = null;
      aqiLayerRef.current = null;
      layers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the animation while the panel is scrolled out of view (it lives below the
  // fold now, so we don't want it looping and fetching tiles unseen).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "150px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Base layer, swapped when the theme changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseRef.current) map.removeLayer(baseRef.current);
    const base = L.tileLayer(cartoUrl(theme), { subdomains: "abcd", maxZoom: 18, attribution: CARTO_ATTR });
    base.addTo(map);
    base.bringToBack();
    baseRef.current = base;
  }, [theme]);

  // Recenter when the searched place changes.
  useEffect(() => {
    mapRef.current?.setView([place.latitude, place.longitude]);
  }, [place.latitude, place.longitude]);

  // Add/remove the air-quality field layer as it's toggled.
  useEffect(() => {
    const map = mapRef.current;
    const layer = aqiLayerRef.current;
    if (!map || !layer) return;
    if (aqiOn) layer.addTo(map);
    else map.removeLayer(layer);
  }, [aqiOn]);

  // Slice the grid at the active timeline hour and push it into the layer, so the
  // field follows the radar scrubber. Re-runs on toggle-on with the cached grid.
  useEffect(() => {
    const layer = aqiLayerRef.current;
    if (!layer || !aqiOn) return;
    const at = activeFrameTime ?? Date.now() / 1000;
    layer.setSamples(aqiGrid ? sampleAqiGridAt(aqiGrid, at) : []);
  }, [aqiOn, aqiGrid, activeFrameTime]);

  // Fetch an hourly US-AQI grid over the current view when the overlay is on,
  // refetching (debounced) after each pan/zoom. One Open-Meteo call per view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !aqiOn) return;
    let timer = 0;
    let ctrl: AbortController | null = null;
    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const b = map.getBounds();
      fetchAqiGrid(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        ctrl.signal,
      )
        .then((grid) => {
          setAqiGrid(grid);
          setAqiError(false);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) setAqiError(true);
        });
    };
    const onMove = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, AQI_REFETCH_MS);
    };
    map.on("moveend", onMove);
    load();
    return () => {
      window.clearTimeout(timer);
      ctrl?.abort();
      map.off("moveend", onMove);
    };
  }, [aqiOn]);

  // New frame index arrived (initial load or a poll): drop stale layers/loaded
  // markers and jump to the latest observed frame ("now").
  useEffect(() => {
    const map = mapRef.current;
    if (map) layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current.clear();
    loadedRef.current.clear();
    if (data && data.frames.length) setIndex(Math.max(0, data.nowcastStart - 1));
  }, [data]);

  // Reveal the current frame (create its layer if scrubbing landed on a new one),
  // hiding the rest — and hide all frames when the radar layer is toggled off. The
  // play loop preloads before setting index, so the swap here is instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const frame = data.frames[index];
    if (!frame) return;
    void ensureRadarLayer(map, data, layersRef.current, loadedRef.current, index);
    layersRef.current.forEach((l, time) =>
      l.setOpacity(radarOn && time === frame.time ? RADAR_OPACITY : 0),
    );
  }, [index, data, radarOn]);

  // Animation loop: preload the NEXT frame's tiles (and wait at least one frame
  // interval) BEFORE advancing, so a freshly-loaded frame never flashes in.
  useEffect(() => {
    const map = mapRef.current;
    if (!playing || !visible || frameCount < 2 || !data || !map) return;
    let cancelled = false;
    let cur = indexRef.current;
    const tick = async () => {
      const next = (cur + 1) % frameCount;
      await Promise.all([
        ensureRadarLayer(map, data, layersRef.current, loadedRef.current, next),
        new Promise((r) => window.setTimeout(r, FRAME_MS)),
      ]);
      if (cancelled) return;
      cur = next;
      setIndex(next);
      void tick();
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [playing, visible, frameCount, data]);

  const frame = data?.frames[index];

  return (
    <section className="panel radar-panel" aria-label="Precipitation radar">
      <div className="radar-map-wrap">
        <div
          ref={containerRef}
          className="radar-map"
          aria-label={`Precipitation radar near ${place.name}`}
        />

        {aqiOn ? (
          <div className="aqi-legend" aria-hidden="true">
            <span className="aqi-legend__title">Air quality (US AQI){aqiError ? " · offline" : ""}</span>
            <div className="aqi-legend__scale">
              {AQI_LEGEND.map((c) => (
                <span key={c.label} className="aqi-legend__swatch" style={{ background: c.color }} title={c.label} />
              ))}
            </div>
            <div className="aqi-legend__ends">
              <span>Good</span>
              <span>Hazardous</span>
            </div>
          </div>
        ) : null}

        {radar.isError ? (
          <div className="radar-status radar-status--error">
            Couldn’t load radar.{" "}
            <button className="btn" onClick={() => radar.refetch()}>
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <div className="radar-options">
        <div className="radar-options__group">
          <span className="radar-options__label">Layers</span>
          <label className="radar-check">
            <input type="checkbox" checked={radarOn} onChange={() => setRadarOn((v) => !v)} />
            Radar
          </label>
          <label className="radar-check">
            <input type="checkbox" checked={aqiOn} onChange={() => setAqiOn((v) => !v)} />
            Air quality
          </label>
        </div>

        <div className="radar-options__group">
          <span className="radar-options__label">Timeline</span>
          <div className="radar-playback">
            <button
              type="button"
              className="radar-play"
              aria-label={playing ? "Pause radar animation" : "Play radar animation"}
              onClick={() => setPlaying((p) => !p)}
              disabled={frameCount < 2}
            >
              <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
            </button>
            <span className="radar-time">
              {frame ? formatClock(frame.time) : radar.isLoading ? "Loading…" : "—"}
              {frame?.nowcast ? <span className="radar-time__tag">forecast</span> : null}
            </span>
          </div>
          <input
            type="range"
            className="radar-scrubber"
            min={0}
            max={Math.max(0, frameCount - 1)}
            value={index}
            disabled={frameCount < 2}
            aria-label="Radar time"
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </div>
      </div>
    </section>
  );
}
