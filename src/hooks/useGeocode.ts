// Debounced geocoding search for the city box.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGeocode } from "../api/openMeteo";

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

  const result = useQuery({
    queryKey: ["geocode", debounced],
    queryFn: ({ signal }) => fetchGeocode(debounced, signal),
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
  });

  return {
    results: result.data?.results ?? [],
    isLoading: enabled && result.isFetching,
    isActive: enabled,
  };
}
