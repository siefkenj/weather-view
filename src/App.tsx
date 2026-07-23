import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LocationSearch } from "./components/LocationSearch";
import { SettingsMenu } from "./components/SettingsMenu";
import { WeatherIcon } from "./components/WeatherIcon";
import { useApplyTheme } from "./hooks/useTheme";
import { useUrlSync } from "./store/urlSync";
import { placeToSlug } from "./utils/place";
import type { Place } from "./api/types";

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // App-wide side effects: keep the URL in sync with the view slice, and reflect
  // the theme onto the document.
  useUrlSync();
  useApplyTheme();

  function goToPlace(place: Place) {
    // Keep the query string (visible-forecast state); carry the rich place in
    // router state so labels stay complete without a re-geocode.
    navigate(`/${placeToSlug(place)}${location.search}`, { state: { place } });
  }

  return (
    <div className="app">
      <header className="app__header">
        <a
          className="brand"
          href={`#/`}
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <WeatherIcon kind="partly-cloudy" size={26} title="Weather View" className="brand__mark" />
          <span className="brand__name">Weather View</span>
        </a>
        <div className="app__header-actions">
          <LocationSearch onSelect={goToPlace} />
          <SettingsMenu />
        </div>
      </header>

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
