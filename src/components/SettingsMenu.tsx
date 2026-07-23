// Settings popover that lives in the header next to the search box. Holds the
// chart options (the old "Options" panel) plus the light/dark theme switch.
// It reads dashboard state straight from the URL via useDashboardState, so it
// needs no props threaded down from the Dashboard.

import { useEffect, useRef, useState } from "react";
import { LayerControls } from "./LayerControls";
import { useDashboardState } from "../hooks/useUrlState";
import { useTheme } from "../hooks/useTheme";

export function SettingsMenu() {
  const { state, ...controls } = useDashboardState();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        </div>
      ) : null}
    </div>
  );
}
