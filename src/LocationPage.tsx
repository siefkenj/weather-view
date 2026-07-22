import { useMemo } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Dashboard } from "./components/Dashboard";
import { fetchGeocode } from "./api/openMeteo";
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

  const resolveQ = useQuery({
    queryKey: ["resolve", parsed?.name],
    queryFn: ({ signal }) => fetchGeocode(parsed?.name ?? "", signal),
    enabled: needsResolve && !!parsed?.name,
    staleTime: Infinity,
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
    return <Dashboard key={placeToSlug(place)} place={place} />;
  }

  // Need to geocode the label.
  if (resolveQ.isLoading) {
    return <div className="state state--loading">Finding “{parsed.name}”…</div>;
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
