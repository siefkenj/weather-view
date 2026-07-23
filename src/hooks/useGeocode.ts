// Debounced geocoding search for the city box. Curated Ontario places (parks,
// conservation areas, landmarks the geocoder misses) are merged in on top.

import { useEffect, useMemo, useRef, useState } from "react";
import { useGeocodeQuery } from "../store/openMeteoApi";
import { curatedMatches, placeNameKey } from "../utils/curatedPlaces";
import type { GeocodingResponse } from "../api/types";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useGeocode(query: string) {
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 250);
  const enabled = debounced.length >= 2;

  const result = useGeocodeQuery(debounced, { skip: !enabled });

  // Keep the previous list on screen between keystrokes so results don't flicker.
  const lastData = useRef<GeocodingResponse | undefined>(undefined);
  if (result.data !== undefined) lastData.current = result.data;
  const apiResults = (result.data ?? (result.isFetching ? lastData.current : undefined))?.results;

  const results = useMemo(() => {
    const curated = curatedMatches(debounced);
    const seen = new Set(curated.map((c) => placeNameKey(c.name)));
    const rest = (apiResults ?? []).filter((r) => !seen.has(placeNameKey(r.name)));
    return [...curated, ...rest];
  }, [debounced, apiResults]);

  return {
    results,
    isLoading: enabled && result.isFetching,
    isActive: enabled,
  };
}
