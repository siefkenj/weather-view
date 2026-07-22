import { useEffect, useId, useRef, useState } from "react";
import { useGeocode } from "../hooks/useGeocode";
import type { GeoLocation, Place } from "../api/types";

interface Props {
  onSelect: (place: Place) => void;
  placeholder?: string;
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

function subtitle(g: GeoLocation): string {
  return [g.admin1, g.country].filter(Boolean).join(", ");
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
 */
export function LocationSearch({ onSelect, placeholder = "Search for a city…" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { results, isLoading, isActive } = useGeocode(query);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => setActive(0), [results]);

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

  function choose(g: GeoLocation) {
    onSelect(toPlace(g));
    collapse();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      collapse();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
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

  const showList = isActive;

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
          {isLoading && results.length === 0 ? (
            <li className="location-search__empty">Searching…</li>
          ) : results.length === 0 ? (
            <li className="location-search__empty">No matches</li>
          ) : (
            results.map((g, idx) => (
              <li key={g.id} role="option" aria-selected={idx === active}>
                <button
                  type="button"
                  className={"location-search__item" + (idx === active ? " is-active" : "")}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(g)}
                >
                  <span className="location-search__name">{g.name}</span>
                  <span className="location-search__sub">{subtitle(g)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
