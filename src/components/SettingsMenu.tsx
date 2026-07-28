// Settings popover that lives in the header next to the search box. Holds the
// chart options (the old "Options" panel) plus the light/dark theme switch.
// It reads dashboard state straight from the URL via useDashboardState, so it
// needs no props threaded down from the Dashboard.

import { useEffect, useRef, useState } from "react";
import { LayerControls } from "./LayerControls";
import { WeatherIcon } from "./WeatherIcon";
import { useDashboardState } from "../hooks/useUrlState";
import { useTheme } from "../hooks/useTheme";
import { cacheStats, clearCache, type CacheStats } from "../api/httpCache";
import { clearStatusErrors } from "../status/statusStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function SettingsMenu() {
  const { state, ...controls } = useDashboardState();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<CacheStats>(() => cacheStats());
  const ref = useRef<HTMLDivElement>(null);

  // Refresh the cache figures each time the menu opens.
  useEffect(() => {
    if (open) setStats(cacheStats());
  }, [open]);

  const clearData = () => {
    clearCache();
    clearStatusErrors(); // any "rate-limited, showing cached data" note is now moot
    setStats(cacheStats());
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      <button
        type="button"
        className="settings__btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Settings"
        title="Chart options and theme"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⚙</span>
      </button>

      {open ? (
        <div className="settings__menu" role="dialog" aria-label="Settings">
          <div className="settings__brand">
            <WeatherIcon kind="partly-cloudy" size={22} title="Weather View" className="brand__mark" />
            <span className="brand__name">Weather View</span>
          </div>

          <div className="settings__section">
            <span className="settings__heading">Theme</span>
            <div className="controls__group segmented" role="group" aria-label="Theme">
              <button
                className={"seg" + (theme === "light" ? " seg--on" : "")}
                title="Light theme."
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                ☀ Light
              </button>
              <button
                className={"seg" + (theme === "dark" ? " seg--on" : "")}
                title="Dark theme."
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                ☾ Dark
              </button>
            </div>
          </div>

          <div className="settings__section">
            <span className="settings__heading">Chart</span>
            <LayerControls
              state={state}
              setDays={controls.setDays}
              setCi={controls.setCi}
              setUnits={controls.setUnits}
            />
          </div>

          <div className="settings__section">
            <span className="settings__heading">Data</span>
            <p className="settings__hint">
              Forecasts are cached in your browser for faster loads and to ease Open-Meteo’s
              rate limits. Entries refresh each hour and clear automatically after two days.
            </p>
            <div className="settings__data">
              <span className="settings__data-stat">
                {stats.count === 0
                  ? "Cache empty"
                  : `${stats.count} cached · ${formatBytes(stats.bytes)}`}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={clearData}
                disabled={stats.count === 0}
                title="Delete all cached forecast, air-quality, wind and radar data."
              >
                Clear cached data
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
