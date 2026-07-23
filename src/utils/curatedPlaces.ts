// Open-Meteo's geocoder misses many Ontario parks, conservation areas and
// landmarks (University of Toronto, Niagara Glen, Rattlesnake Point, …) or maps
// their names elsewhere. This curated list is merged into search results so
// these places are always findable. Coordinates are approximate — fine for a
// forecast — and every entry is in the America/Toronto zone.

import type { GeoLocation } from "../api/types";

interface Curated {
  name: string;
  latitude: number;
  longitude: number;
  /** Extra search terms (all lowercase). */
  aliases?: string[];
}

const ONTARIO: Curated[] = [
  { name: "University of Toronto", latitude: 43.6629, longitude: -79.3957, aliases: ["u of t", "uoft", "st george", "campus", "university"] },
  { name: "Niagara Glen Nature Reserve", latitude: 43.1163, longitude: -79.0569, aliases: ["nature reserve", "preserve", "gorge", "hiking", "niagara"] },
  { name: "Mount Nemo Conservation Area", latitude: 43.4041, longitude: -79.9147, aliases: ["conservation area", "cliffs", "burlington", "bruce trail"] },
  { name: "Rattlesnake Point Conservation Area", latitude: 43.4906, longitude: -79.9186, aliases: ["conservation area", "milton", "bruce trail", "climbing"] },
  { name: "Niagara-on-the-Lake", latitude: 43.2557, longitude: -79.0715, aliases: ["notl", "niagara on the lake", "wine"] },
  { name: "Bruce Peninsula National Park", latitude: 45.2419, longitude: -81.51, aliases: ["the grotto", "tobermory", "hiking", "bruce trail"] },
  { name: "Algonquin Provincial Park", latitude: 45.586, longitude: -78.3536, aliases: ["hiking", "canoe", "park"] },
  { name: "Killarney Provincial Park", latitude: 46.0119, longitude: -81.4009, aliases: ["the crack", "la cloche", "hiking"] },
  { name: "Sleeping Giant Provincial Park", latitude: 48.3547, longitude: -88.7788, aliases: ["thunder bay", "hiking"] },
  { name: "Ouimet Canyon Provincial Park", latitude: 48.785, longitude: -88.66, aliases: ["canyon", "thunder bay"] },
  { name: "Point Pelee National Park", latitude: 41.96, longitude: -82.5185, aliases: ["leamington", "birding"] },
  { name: "Sandbanks Provincial Park", latitude: 43.91, longitude: -77.24, aliases: ["prince edward county", "dunes", "beach"] },
  { name: "Frontenac Provincial Park", latitude: 44.52, longitude: -76.54, aliases: ["kingston", "hiking"] },
  { name: "Petroglyphs Provincial Park", latitude: 44.6106, longitude: -78.0525, aliases: ["peterborough"] },
  { name: "Elora Gorge Conservation Area", latitude: 43.679, longitude: -80.437, aliases: ["quarry", "tubing", "hiking"] },
  { name: "Rockwood Conservation Area", latitude: 43.6128, longitude: -80.1447, aliases: ["guelph", "caves"] },
  { name: "Dundas Peak", latitude: 43.2794, longitude: -79.976, aliases: ["tews falls", "hamilton", "hiking"] },
  { name: "Webster's Falls", latitude: 43.276, longitude: -79.972, aliases: ["hamilton", "waterfall", "dundas"] },
  { name: "Devil's Punch Bowl Conservation Area", latitude: 43.2069, longitude: -79.7539, aliases: ["hamilton", "waterfall", "stoney creek"] },
  { name: "Scarborough Bluffs", latitude: 43.7064, longitude: -79.232, aliases: ["bluffers park", "toronto"] },
  { name: "Rouge National Urban Park", latitude: 43.8206, longitude: -79.17, aliases: ["toronto", "scarborough", "hiking"] },
  { name: "Cheltenham Badlands", latitude: 43.7497, longitude: -79.9216, aliases: ["caledon"] },
  { name: "Forks of the Credit Provincial Park", latitude: 43.792, longitude: -80.023, aliases: ["caledon", "hiking"] },
  { name: "Hilton Falls Conservation Area", latitude: 43.5064, longitude: -79.9564, aliases: ["milton", "waterfall"] },
  { name: "Crawford Lake Conservation Area", latitude: 43.4686, longitude: -79.9497, aliases: ["milton", "hiking"] },
  { name: "Mono Cliffs Provincial Park", latitude: 44.043, longitude: -80.083, aliases: ["orangeville", "bruce trail"] },
  { name: "Lion's Head Provincial Park", latitude: 44.9903, longitude: -81.247, aliases: ["bruce trail", "bruce peninsula", "hiking"] },
  { name: "Awenda Provincial Park", latitude: 44.8386, longitude: -79.984, aliases: ["penetanguishene", "beach"] },
  { name: "Killbear Provincial Park", latitude: 45.356, longitude: -80.217, aliases: ["parry sound", "beach"] },
  { name: "Bon Echo Provincial Park", latitude: 44.8967, longitude: -77.205, aliases: ["mazinaw", "cliffs"] },
  { name: "Warsaw Caves Conservation Area", latitude: 44.456, longitude: -78.125, aliases: ["peterborough", "caves"] },
  { name: "Short Hills Provincial Park", latitude: 43.118, longitude: -79.256, aliases: ["st catharines", "hiking"] },
  { name: "Bronte Creek Provincial Park", latitude: 43.403, longitude: -79.742, aliases: ["oakville", "hiking"] },
  { name: "Pinery Provincial Park", latitude: 43.256, longitude: -81.83, aliases: ["grand bend", "dunes", "beach"] },
];

function toGeoLocation(p: Curated, index: number): GeoLocation {
  return {
    id: -1000 - index,
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    admin1: "Ontario",
    country: "Canada",
    country_code: "CA",
    timezone: "America/Toronto",
  };
}

/** Curated Ontario places whose name/aliases contain every whitespace token of the query. */
export function curatedMatches(query: string): GeoLocation[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const out: GeoLocation[] = [];
  ONTARIO.forEach((p, i) => {
    const hay = `${p.name} ontario canada ${(p.aliases ?? []).join(" ")}`.toLowerCase();
    if (tokens.every((t) => hay.includes(t))) out.push(toGeoLocation(p, i));
  });
  return out;
}

/** Normalized key for de-duplicating a place name against the geocoder's results. */
export function placeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
