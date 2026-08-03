// The weather models offered in the settings picker. Each id is an Open-Meteo
// `models=` value (the "_seamless" combos stitch a provider's global + high-res
// regional models into one series). Selecting two or more blends them into a
// consensus (see utils/consensus); selecting none falls back to `best_match`,
// Open-Meteo's automatic per-location pick.
//
// `best_match` is deliberately NOT in this list: it's itself a meta-model that
// silently adopts one of these, so including it in a consensus would double-count
// whichever model it chose.

export interface WeatherModel {
  /** Open-Meteo `models=` id. */
  id: string;
  /** Short name shown in the picker. */
  label: string;
  /** Issuing agency / country. */
  agency: string;
  /** Where this model is strongest — the reason to include it. */
  region: string;
}

export const MODELS: WeatherModel[] = [
  { id: "ecmwf_ifs025", label: "ECMWF IFS", agency: "ECMWF (EU)", region: "Global · reference standard" },
  { id: "gfs_seamless", label: "GFS", agency: "NOAA (US)", region: "Global · strong over N. America" },
  { id: "icon_seamless", label: "ICON", agency: "DWD (Germany)", region: "Global · high-res, strong in Europe" },
  { id: "gem_seamless", label: "GEM", agency: "ECCC (Canada)", region: "Global · strong over Canada" },
  { id: "ukmo_seamless", label: "UKMO", agency: "Met Office (UK)", region: "Global · strong over the UK" },
  { id: "meteofrance_seamless", label: "Météo-France", agency: "Météo-France", region: "Global · high-res over W. Europe" },
  { id: "jma_seamless", label: "JMA", agency: "JMA (Japan)", region: "Global · strong over E. Asia" },
  { id: "knmi_seamless", label: "KNMI HARMONIE", agency: "KNMI (Netherlands)", region: "High-res · N.W. Europe only" },
  { id: "metno_seamless", label: "MET Norway", agency: "MET Norway", region: "High-res · Nordics only" },
];

/** Valid picker ids, for filtering unknown/legacy model params out of the URL. */
export const MODEL_IDS = new Set(MODELS.map((m) => m.id));

/** The friendly label for a model id, or the raw id if it isn't one we list. */
export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}
