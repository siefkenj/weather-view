// Debounced geocoding search for the city box. Two requests are merged per query (see
// utils/placeSearch for why), then filtered and ranked client-side. Curated Ontario
// places (parks, conservation areas, landmarks the geocoder misses) go on top.

import { useEffect, useMemo, useRef, useState } from "react";
import { useGeocodeQuery } from "../store/openMeteoApi";
import { curatedMatches, placeNameKey } from "../utils/curatedPlaces";
import { queryCandidates, rankPlaces } from "../utils/placeSearch";
import type { GeoLocation, GeocodingResponse } from "../api/types";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Holds the last results so the list doesn't blank out between keystrokes. */
function useStableResults(data: GeocodingResponse | undefined, isFetching: boolean) {
  const last = useRef<GeocodingResponse | undefined>(undefined);
  if (data !== undefined) last.current = data;
  return (data ?? (isFetching ? last.current : undefined))?.results;
}

export function useGeocode(query: string) {
  const debounced = useDebounced(query.trim(), 250);
  // Candidate 1 is the whole query (multi-word names); candidate 2 is its first word
  // (a wide net the remaining words narrow). Identical for a single word — then the
  // second query is skipped and only one request goes out.
  const candidates = useMemo(() => queryCandidates(debounced), [debounced]);
  const [whole = "", firstWord = ""] = candidates;
  const enabled = candidates.length > 0;

  const wholeQ = useGeocodeQuery(whole, { skip: !enabled });
  const firstQ = useGeocodeQuery(firstWord, { skip: !firstWord || firstWord === whole });

  const wholeResults = useStableResults(wholeQ.data, wholeQ.isFetching);
  const firstResults = useStableResults(firstQ.data, firstQ.isFetching);

  const results = useMemo(() => {
    const curated = curatedMatches(debounced);
    const seen = new Set(curated.map((c) => placeNameKey(c.name)));
    // Merge both responses, dropping repeats by geocoder id (the two queries overlap).
    const merged: GeoLocation[] = [];
    const ids = new Set<number>();
    for (const r of [...(wholeResults ?? []), ...(firstResults ?? [])]) {
      if (ids.has(r.id) || seen.has(placeNameKey(r.name))) continue;
      ids.add(r.id);
      merged.push(r);
    }
    return [...curated, ...rankPlaces(merged, debounced)];
  }, [debounced, wholeResults, firstResults]);

  return {
    results,
    isLoading: enabled && (wholeQ.isFetching || firstQ.isFetching),
    isActive: enabled,
  };
}
