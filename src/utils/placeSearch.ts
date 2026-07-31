// How the city search turns what a user types into a ranked list of places.
//
// The Open-Meteo geocoder matches on the place NAME only, and it is picky about
// punctuation. Probing it shows no single request form covers real input:
//
//   "london, ontario"      full-string → 0 hits   | first token "london," → all Londons
//   "new york"             full-string → New York | first token "new"     → buried in noise
//   "st. catharines"       full-string → 2 hits   | (the dot matters: "st catharines" → 0)
//   "niagara on the lake"  full-string → 0 hits   | first token "niagara" → the hyphenated name
//
// So we ask for BOTH the whole query (nails multi-word names, keeping the user's
// punctuation, which the geocoder wants) and the bare first word (gives a wide net a
// trailing qualifier can narrow), then merge and rank the union here. Filtering is
// deliberately done client-side: it's the only place that can see "Ontario" as a
// qualifier rather than part of the name.

import type { GeoLocation } from "../api/types";

/** Minimum typed characters before searching (after punctuation is stripped). */
export const MIN_QUERY_LENGTH = 2;

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
// Anything that isn't a letter or digit in ANY script is a separator, so "London, ON",
// "London/ON", "London-ON" and "London ON" all tokenize identically. Unicode-aware so
// non-Latin queries (e.g. 東京, Москва) survive.
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/** Lowercase, strip accents, and reduce every separator to a single space. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").replace(SEPARATORS, " ").trim();
}

/** The query's comparable words: "London, ON" → ["london", "on"]. */
export function tokenize(query: string): string[] {
  const n = normalize(query);
  return n ? n.split(" ") : [];
}

// Postal abbreviations for US states and Canadian provinces, so "Austin TX" and
// "Vancouver BC" work. Keyed by the normalized region name the geocoder returns.
const REGION_ABBR: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx",
  utah: "ut", vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv",
  wisconsin: "wi", wyoming: "wy", "district of columbia": "dc",
  ontario: "on", quebec: "qc", "british columbia": "bc", alberta: "ab",
  manitoba: "mb", saskatchewan: "sk", "nova scotia": "ns", "new brunswick": "nb",
  "newfoundland and labrador": "nl", "prince edward island": "pe", yukon: "yt",
  "northwest territories": "nt", nunavut: "nu",
};

// Everyday names for countries whose ISO code or official name people don't type.
// (The ISO code itself is already searchable, so this covers only the mismatches.)
const COUNTRY_ALIASES: Record<string, string> = {
  gb: "uk britain", us: "usa america", ae: "uae", nl: "holland", kr: "south korea",
  kp: "north korea", cz: "czech republic czechia", mm: "burma", tr: "turkey",
};

/** Every word a result can be matched on: its name, the regions and country holding
 *  it, and the abbreviations people actually type for those. */
function searchWords(r: GeoLocation): string[] {
  const code = (r.country_code ?? "").toLowerCase();
  const parts = [r.name, r.admin1, r.admin2, r.country, r.country_code];
  const extra = [REGION_ABBR[normalize(r.admin1 ?? "")], COUNTRY_ALIASES[code]];
  return normalize([...parts, ...extra].filter(Boolean).join(" ")).split(" ");
}

/** A token matches when some word STARTS with it, so partial qualifiers work
 *  ("london ont" → Ontario) without matching mid-word noise ("ork" ↛ York). */
function matchesAll(words: string[], tokens: string[]): boolean {
  return tokens.every((t) => words.some((w) => w.startsWith(t)));
}

/**
 * The name strings to ask the geocoder for. Raw (not normalized) because the geocoder
 * wants the user's punctuation — "st. catharines" finds the city while "st catharines"
 * finds nothing — but the fallback word is normalized so "london,ontario" (no space)
 * still yields "london".
 */
export function queryCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const first = tokenize(trimmed)[0] ?? "";
  const out: string[] = [];
  const seen = new Set<string>();
  // Compared normalized, so a lone word ("Toronto" vs "toronto") is ONE request.
  for (const c of [trimmed, first]) {
    const n = normalize(c);
    if (n.length < MIN_QUERY_LENGTH || seen.has(n)) continue;
    seen.add(n);
    out.push(c);
  }
  return out;
}

/**
 * Keep the results that match EVERY word typed, best first. Every token must appear
 * somewhere in the result's searchable words, so a trailing qualifier narrows instead
 * of being searched for literally: "london ontario" keeps London, ON and drops London, UK.
 */
export function rankPlaces(results: GeoLocation[], query: string, limit = 8): GeoLocation[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return results.slice(0, limit);
  const nq = tokens.join(" ");

  const kept = results.filter((r) => matchesAll(searchWords(r), tokens));
  // Rank by how exactly the NAME accounts for what was typed:
  //   0  the name is the whole query          — "new york"    → New York
  //   1  the name is the query minus trailing qualifiers — "vancouver bc" → Vancouver
  //   2  the name merely begins with it       — "vancouver bc" → Vancouver Island
  //   3  it matched on a region/country word only
  // Without tier 1, "Vancouver Island" (bigger population) would bury the city.
  const prefixes = tokens.map((_t, i) => tokens.slice(0, i + 1).join(" "));
  const rankOf = (r: GeoLocation) => {
    const name = normalize(r.name);
    if (name === nq) return 0;
    if (prefixes.includes(name)) return 1;
    return name.startsWith(tokens[0]) ? 2 : 3;
  };
  return kept
    .map((r, i) => ({ r, i, rank: rankOf(r) }))
    .sort((a, b) => a.rank - b.rank || (b.r.population ?? 0) - (a.r.population ?? 0) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.r);
}
