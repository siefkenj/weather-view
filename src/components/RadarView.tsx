// Precipitation-radar map. Lazy-loaded (Leaflet + its CSS live in this chunk, off
// the main bundle). A CARTO base layer tracks the app theme; RainViewer radar
// frames animate on top with a play/scrub timeline. Default-exported for React.lazy.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRadarFramesQuery } from "../store/openMeteoApi";
import { radarTileUrl, type RadarIndex } from "../api/rainviewer";
import { AqiGridLayer } from "./aqiGridLayer";
import { WindLayer } from "./windLayer";
import { fetchAqiGrid, sampleAqiGridAt, AQI_LEGEND, type AqiGrid } from "../api/airQualityGrid";
import { fetchWindPoints, windLatticePoints, dataZoomFor, WindFieldCache, type LatticePoint } from "../api/windGrid";
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
// The scrubbable timeline spans 6 h of history + 6 h of forecast at 10-min steps,
// anchored at "now". RainViewer only serves ~2 h of radar frames (+ short nowcast),
// so most steps carry no radar tile — but the air-quality field (data over days)
// interpolates across the whole range, so the timeline visibly changes over time
// and can be scrubbed into the forecast.
const TIMELINE_PAST_HOURS = 6;
const TIMELINE_FUTURE_HOURS = 6;
const TIMELINE_STEP_S = 600;

/** A scrubber stop: a timestamp, plus the radar frame index at that time if any. */
interface TimeStep {
  time: number;
  radarIndex: number | null;
}
interface Timeline {
  steps: TimeStep[];
  /** Step index nearest the present (the latest observed radar frame). */
  nowIndex: number;
  /** Timestamp of "now". */
  nowTime: number | null;
}

/** Build the past+forecast timeline, attaching each radar frame to its step. */
function buildTimeline(data: RadarIndex | undefined): Timeline {
  if (!data || data.frames.length === 0) return { steps: [], nowIndex: 0, nowTime: null };
  const frames = data.frames;
  const nowTime = frames[Math.max(0, data.nowcastStart - 1)].time;
  const start = nowTime - TIMELINE_PAST_HOURS * 3600;
  const end = nowTime + TIMELINE_FUTURE_HOURS * 3600;
  const steps: TimeStep[] = [];
  let nowIndex = 0;
  let bestNow = Infinity;
  for (let t = start, i = 0; t <= end + 1; t += TIMELINE_STEP_S, i++) {
    // Frames are aligned to the same 10-min cadence; match within half a step.
    let radarIndex: number | null = null;
    for (let k = 0; k < frames.length; k++) {
      if (Math.abs(frames[k].time - t) < TIMELINE_STEP_S / 2) {
        radarIndex = k;
        break;
      }
    }
    steps.push({ time: t, radarIndex });
    if (Math.abs(t - nowTime) < bestNow) {
      bestNow = Math.abs(t - nowTime);
      nowIndex = i;
    }
  }
  return { steps, nowIndex, nowTime };
}
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
  const windLayerRef = useRef<WindLayer | null>(null);
  // Wind is sampled on a quantized lattice and cached, so pans/zooms reuse points
  // and only the newly-revealed cells are fetched (see WindFieldCache).
  const windCacheRef = useRef(new WindFieldCache());
  const windPointsRef = useRef<LatticePoint[]>([]);
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
  const [windOn, setWindOn] = useState(false);
  const [aqiGrid, setAqiGrid] = useState<AqiGrid | null>(null);
  const [aqiError, setAqiError] = useState(false);
  // Bumped whenever the wind cache or visible cells change, to re-sample the layer.
  const [windVersion, setWindVersion] = useState(0);

  const { steps: timeline, nowIndex, nowTime } = useMemo(() => buildTimeline(data), [data]);
  const stepCount = timeline.length;
  const step = timeline[index];
  // The radar frame at this step (if any) and the timestamp the field follows.
  const activeFrame = step?.radarIndex != null ? data?.frames[step.radarIndex] : undefined;
  const activeFrameTime = step?.time ?? null;

  // The contiguous span of the timeline that actually has radar frames, as track
  // percentages — used to shade the scrubber (radar-available vs overlay-only).
  const radarBand = useMemo(() => {
    if (stepCount < 2) return { start: 0, end: 0 };
    let lo = -1;
    let hi = -1;
    timeline.forEach((s, i) => {
      if (s.radarIndex != null) {
        if (lo < 0) lo = i;
        hi = i;
      }
    });
    if (lo < 0) return { start: 0, end: 0 };
    const half = 0.5 / (stepCount - 1);
    return {
      start: Math.max(0, lo / (stepCount - 1) - half) * 100,
      end: Math.min(1, hi / (stepCount - 1) + half) * 100,
    };
  }, [timeline, stepCount]);

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
    // Explicit stack above the base map: air-quality field, radar, then wind arrows
    // on top (so the vectors stay legible over precipitation).
    map.createPane("aqi").style.zIndex = "240";
    map.createPane("radar").style.zIndex = "250";
    map.createPane("wind").style.zIndex = "260";
    const aqiLayer = new AqiGridLayer({ pane: "aqi" });
    aqiLayerRef.current = aqiLayer;
    const windLayer = new WindLayer({ pane: "wind" });
    windLayerRef.current = windLayer;
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
      windLayerRef.current = null;
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
    // Blue wind arrows, shade tuned to stay legible against the current base map.
    windLayerRef.current?.setColor(theme === "dark" ? "#5aa2f0" : "#1866c0");
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

  // Add/remove the wind vector-field layer as it's toggled.
  useEffect(() => {
    const map = mapRef.current;
    const layer = windLayerRef.current;
    if (!map || !layer) return;
    if (windOn) layer.addTo(map);
    else map.removeLayer(layer);
  }, [windOn]);

  // Slice the grid at the active timeline hour and push it into the layer, so the
  // field follows the radar scrubber. Re-runs on toggle-on with the cached grid.
  useEffect(() => {
    const layer = aqiLayerRef.current;
    if (!layer || !aqiOn) return;
    const at = activeFrameTime ?? Date.now() / 1000;
    layer.setSamples(aqiGrid ? sampleAqiGridAt(aqiGrid, at) : []);
  }, [aqiOn, aqiGrid, activeFrameTime]);

  // Same for the wind field: read the visible cached cells and interpolate the
  // vectors at the active timeline time. Re-runs when the cache/viewport changes
  // (windVersion) or the timeline moves. If the new (e.g. just-zoomed) level has no
  // cached cells yet, keep the previous arrows — they're still the right area, just
  // a coarser grid — so the field never blinks out while the new data loads.
  useEffect(() => {
    const layer = windLayerRef.current;
    if (!layer || !windOn) return;
    const at = activeFrameTime ?? Date.now() / 1000;
    const samples = windCacheRef.current.samplesAt(windPointsRef.current, at);
    if (samples.length) layer.setSamples(samples);
  }, [windOn, windVersion, activeFrameTime]);

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

  // Resample the wind lattice for the current view when the overlay is on. On each
  // (debounced) move we snap the viewport to the zoom's lattice, redraw immediately
  // from whatever's cached, and fetch ONLY the cells we don't have yet — so a small
  // pan sends a thin request (or none), not a whole fresh grid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !windOn) return;
    let timer = 0;
    let ctrl: AbortController | null = null;
    const resample = () => {
      const b = map.getBounds();
      const points = windLatticePoints(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        dataZoomFor(map.getZoom()),
      );
      windPointsRef.current = points;
      setWindVersion((v) => v + 1); // draw cached cells for the new viewport now
      const missing = windCacheRef.current.missing(points);
      if (missing.length === 0) return;
      ctrl?.abort();
      ctrl = new AbortController();
      fetchWindPoints(missing, ctrl.signal)
        .then((grid) => {
          windCacheRef.current.merge(missing, grid);
          setWindVersion((v) => v + 1);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Non-fatal: those cells just stay empty until the next move.
        });
    };
    const onMove = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(resample, AQI_REFETCH_MS);
    };
    map.on("moveend", onMove);
    resample();
    return () => {
      window.clearTimeout(timer);
      ctrl?.abort();
      map.off("moveend", onMove);
    };
  }, [windOn]);

  // New frames arrived (initial load or a poll): drop stale layers/loaded markers
  // and jump to the newest step ("now", the end of the timeline).
  useEffect(() => {
    const map = mapRef.current;
    if (map) layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current.clear();
    loadedRef.current.clear();
    if (timeline.length) setIndex(nowIndex);
  }, [timeline, nowIndex]);

  // Reveal the radar frame at the current step (if this step has one) and hide the
  // rest — also hiding everything when the radar layer is toggled off or the step
  // is in the AQI-only stretch. The play loop preloads first, so the swap is instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const radarIndex = timeline[index]?.radarIndex ?? null;
    if (radarIndex != null) {
      void ensureRadarLayer(map, data, layersRef.current, loadedRef.current, radarIndex);
    }
    const showTime = radarIndex != null ? data.frames[radarIndex].time : null;
    layersRef.current.forEach((l, time) =>
      l.setOpacity(radarOn && time === showTime ? RADAR_OPACITY : 0),
    );
  }, [index, data, radarOn, timeline]);

  // Animation loop: preload the NEXT step's radar tiles (if it has any) and wait at
  // least one frame interval BEFORE advancing, so a freshly-loaded frame never
  // flashes in. Steps without a radar frame just advance (the field interpolates).
  useEffect(() => {
    const map = mapRef.current;
    if (!playing || !visible || stepCount < 2 || !data || !map) return;
    let cancelled = false;
    let cur = indexRef.current;
    const tick = async () => {
      const next = (cur + 1) % stepCount;
      const nextRadar = timeline[next]?.radarIndex ?? null;
      await Promise.all([
        nextRadar != null
          ? ensureRadarLayer(map, data, layersRef.current, loadedRef.current, nextRadar)
          : Promise.resolve(),
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
  }, [playing, visible, stepCount, data, timeline]);

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
          <label className="radar-check">
            <input type="checkbox" checked={windOn} onChange={() => setWindOn((v) => !v)} />
            Wind
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
              disabled={stepCount < 2}
            >
              <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
            </button>
            <span className="radar-time">
              {step ? formatClock(step.time) : radar.isLoading ? "Loading…" : "—"}
              {activeFrame?.nowcast || (step && nowTime != null && step.time > nowTime) ? (
                <span className="radar-time__tag">forecast</span>
              ) : step && step.radarIndex == null ? (
                <span className="radar-time__tag radar-time__tag--muted">no radar</span>
              ) : null}
            </span>
          </div>
          <div
            className="radar-timeline"
            style={
              {
                "--radar-start": `${radarBand.start}%`,
                "--radar-end": `${radarBand.end}%`,
              } as CSSProperties
            }
          >
            <div className="radar-timeline__labels" aria-hidden="true">
              <span className="rt-lab rt-lab--past">Past</span>
              {radarBand.end > radarBand.start ? <span className="rt-lab rt-lab--radar">Radar</span> : null}
              <span className="rt-lab rt-lab--forecast">Forecast</span>
            </div>
            <div className="radar-timeline__bar" aria-hidden="true">
              {radarBand.end > radarBand.start ? <div className="radar-timeline__radar" /> : null}
            </div>
            <input
              type="range"
              className="radar-scrubber"
              min={0}
              max={Math.max(0, stepCount - 1)}
              value={index}
              disabled={stepCount < 2}
              aria-label="Radar time"
              title="Tinted band = live radar (~2 h). Past & Forecast show the air-quality / wind overlays only (no radar)."
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
