import { useMemo } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { Dashboard } from "./components/Dashboard";
import { DashboardSkeleton } from "./components/Skeletons";
import { useGeocodeQuery } from "./store/openMeteoApi";
import { DEFAULT_PLACE, parseSlug, placeToSlug } from "./utils/place";
import type { GeoLocation, Place } from "./api/types";

function geoToPlace(g: GeoLocation): Place {
  return {
    name: g.name,
    latitude: g.latitude,
    longitude: g.longitude,
    admin1: g.admin1,
    country: g.country,
    countryCode: g.country_code,
    timezone: g.timezone,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * Resolves the `:slug` route into a Place. When the slug carries coordinates we
 * use them directly; otherwise we geocode the label once and redirect to the
 * canonical slug (with coordinates) so the URL becomes stable and shareable.
 */
export function LocationPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const parsed = useMemo(() => parseSlug(slug), [slug]);
  const routePlace = (location.state as { place?: Place } | null)?.place;

  const needsResolve = !parsed || parsed.latitude == null || parsed.longitude == null;

  const resolveQ = useGeocodeQuery(parsed?.name ?? "", {
    skip: !(needsResolve && !!parsed?.name),
  });

  if (!parsed) {
    return <Navigate to={`/${placeToSlug(DEFAULT_PLACE)}`} replace />;
  }

  // Slug already has coordinates — render directly.
  if (parsed.latitude != null && parsed.longitude != null) {
    const place: Place =
      routePlace && near(routePlace.latitude, parsed.latitude) && near(routePlace.longitude, parsed.longitude)
        ? routePlace
        : { name: parsed.name, latitude: parsed.latitude, longitude: parsed.longitude };
    // Deliberately NOT keyed on the place: remounting per city tore the whole dashboard
    // down — every widget blanked, and the Leaflet map and ECharts chart were rebuilt
    // from scratch — which is what made a city switch blink. Dashboard resets its own
    // per-place state instead, so the layout stays put and only the data refills.
    return <Dashboard place={place} />;
  }

  // Need to geocode the label.
  if (resolveQ.isLoading) {
    return <DashboardSkeleton />;
  }
  const first = resolveQ.data?.results?.[0];
  if (!first) {
    return (
      <div className="state state--error">
        <p>Couldn’t find “{parsed.name}”.</p>
        <p className="state__detail">Try searching for another city.</p>
      </div>
    );
  }
  return <Navigate to={`/${placeToSlug(geoToPlace(first))}${location.search}`} replace />;
}
