import { Outlet } from "react-router-dom";
import { useApplyTheme } from "./hooks/useTheme";
import { useUrlSync } from "./store/urlSync";

export function App() {
  // App-wide side effects: keep the URL in sync with the view slice, and reflect
  // the theme onto the document. The header lives on the current-conditions card
  // now (search + settings there; the "Weather View" brand moved into settings).
  useUrlSync();
  useApplyTheme();

  return (
    <div className="app">
      <main className="app__main">
        <Outlet />
      </main>

      <footer className="app__footer">
        <span>
          Weather &amp; air-quality data by{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo.com
          </a>{" "}
          (CC BY 4.0)
        </span>
      </footer>
    </div>
  );
}
