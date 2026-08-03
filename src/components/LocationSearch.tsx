import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useGeocode } from "../hooks/useGeocode";
import { placeToSlug } from "../utils/place";
import { getRecentPlaces } from "../utils/recentPlaces";
import type { GeoLocation, Place } from "../api/types";

interface Props {
  onSelect: (place: Place) => void;
  /** Slug of the currently-shown place, hidden from the recents list (you're on it). */
  currentKey?: string;
  placeholder?: string;
}

/** Imperative handle so other header elements (e.g. the place name) can open the box. */
export interface LocationSearchHandle {
  open: () => void;
}

/** A normalized dropdown row — from either a geocoding hit or a stored recent. */
interface Suggestion {
  key: string;
  name: string;
  sub: string;
  place: Place;
}

function toPlace(g: GeoLocation): Place {
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

function geoSub(g: GeoLocation): string {
  return [g.admin1, g.country].filter(Boolean).join(", ");
}

function placeSub(p: Place): string {
  const region = [p.admin1, p.country].filter(Boolean).join(", ");
  return region || `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`;
}

const SearchGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Collapsed by default (just a search icon) since switching cities is rare;
 * expands into a text field on demand and collapses again after a selection or
 * when dismissed. Keeps the weather information as the focus of the header.
 *
 * On open with an empty query it offers the 5 most recently-viewed locations
 * (persisted in localStorage); once the user types, it switches to live geocoding.
 */
export const LocationSearch = forwardRef<LocationSearchHandle, Props>(function LocationSearch(
  { onSelect, currentKey, placeholder = "Search for a city…" },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<Place[]>([]);
  const { results, isLoading, isActive } = useGeocode(query);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useImperativeHandle(ref, () => ({ open: () => setExpanded(true) }), []);

  const trimmed = query.trim();
  const showRecents = trimmed === "";

  // Refresh recents from storage each time the box opens (they change as you navigate).
  useEffect(() => {
    if (expanded) setRecents(getRecentPlaces());
  }, [expanded]);

  // Drop the place you're already viewing, then keep the 5 most recent.
  const recentPlaces = useMemo(
    () => recents.filter((p) => placeToSlug(p) !== currentKey).slice(0, 5),
    [recents, currentKey],
  );

  const suggestions = useMemo<Suggestion[]>(() => {
    if (showRecents) {
      return recentPlaces.map((p) => ({ key: placeToSlug(p), name: p.name, sub: placeSub(p), place: p }));
    }
    return results.map((g) => ({ key: String(g.id), name: g.name, sub: geoSub(g), place: toPlace(g) }));
  }, [showRecents, recentPlaces, results]);

  useEffect(() => setActive(0), [suggestions]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) collapse();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function collapse() {
    setExpanded(false);
    setQuery("");
  }

  function choose(place: Place) {
    onSelect(place);
    collapse();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      collapse();
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(suggestions[active].place);
    }
  }

  if (!expanded) {
    return (
      <div className="location-search location-search--collapsed" ref={rootRef}>
        <button
          type="button"
          className="location-search__toggle"
          aria-label="Search for a city"
          onClick={() => setExpanded(true)}
        >
          <SearchGlyph />
        </button>
      </div>
    );
  }

  // Recents show whenever the field is empty and we have some; otherwise the live search.
  const showList = showRecents ? recentPlaces.length > 0 : isActive;

  const renderItem = (s: Suggestion, idx: number) => (
    <li key={s.key} role="option" aria-selected={idx === active}>
      <button
        type="button"
        className={"location-search__item" + (idx === active ? " is-active" : "")}
        onMouseEnter={() => setActive(idx)}
        onClick={() => choose(s.place)}
      >
        <span className="location-search__name">{s.name}</span>
        <span className="location-search__sub">{s.sub}</span>
      </button>
    </li>
  );

  return (
    <div className="location-search location-search--expanded" ref={rootRef}>
      <span className="location-search__icon">
        <SearchGlyph />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="location-search__input"
        value={query}
        placeholder={placeholder}
        aria-label="Search for a city"
        aria-expanded={showList}
        aria-controls={listId}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul className="location-search__list" id={listId} role="listbox">
          {showRecents ? (
            <>
              <li className="location-search__section" role="presentation">
                Recent
              </li>
              {suggestions.map(renderItem)}
            </>
          ) : isLoading && results.length === 0 ? (
            <li className="location-search__empty">Searching…</li>
          ) : results.length === 0 ? (
            <li className="location-search__empty">No matches</li>
          ) : (
            suggestions.map(renderItem)
          )}
        </ul>
      ) : null}
    </div>
  );
});
