import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { formatDayShort, formatFullDate, formatTime } from "../utils/format";
import { findNowIndex } from "../utils/series";
import type { AirQualityResponse } from "../api/types";

// Hover explanations for the two indices — what they are and how they're computed.
const AQHI_HELP =
  "AQHI — Air Quality Health Index (Canada, scale 1–10+). A short-term health-risk index from " +
  "Environment and Climate Change Canada, computed from the combined health risk of ground-level " +
  "ozone (O₃), nitrogen dioxide (NO₂), and fine particulate matter (PM2.5), using their 3-hour " +
  "average concentrations.";
const AQI_HELP =
  "AQI — U.S. Air Quality Index (US EPA, scale 0–500). Each pollutant (PM2.5, PM10, ozone, NO₂, " +
  "SO₂, CO) is converted to a 0–500 sub-index via EPA concentration breakpoints; the AQI shown is " +
  "the highest sub-index — i.e. the single worst pollutant at that hour.";

interface Props {
  data: AirQualityResponse;
  /** AQHI per hour, aligned to data.hourly.time. */
  aqhi: number[];
  /** Focused hour — the badge/tiles describe this moment. */
  nowIso: string;
}

// The AQHI trend is now drawn in the stacked meteogram; this panel keeps the
// current AQHI badge and the pollutant breakdown for the focused hour.
export function AirQualityPanel({ data, aqhi, nowIso }: Props) {
  const h = data.hourly;
  const units = data.hourly_units;
  const fi = Math.max(0, findNowIndex(h.time, nowIso));
  const focusIso = h.time[fi] ?? nowIso;
  const cat = aqhiCategory(aqhi[fi]);
  const usAqi = h.us_aqi?.[fi];
  const aqiText = usAqi != null && Number.isFinite(usAqi) ? Math.round(usAqi) : "–";

  const tiles = [
    { key: "PM2.5", value: h.pm2_5?.[fi], unit: units.pm2_5 },
    { key: "PM10", value: h.pm10?.[fi], unit: units.pm10 },
    { key: "Ozone", value: h.ozone?.[fi], unit: units.ozone },
    { key: "NO₂", value: h.nitrogen_dioxide?.[fi], unit: units.nitrogen_dioxide },
  ];

  return (
    <section className="panel air-quality" aria-label="Air quality">
      <header className="panel__head">
        <div className="aqi-title">
          <h2>Air quality</h2>
          <span className="aqi-sub" title={formatFullDate(focusIso)}>
            {formatDayShort(focusIso)} · {formatTime(focusIso)}
          </span>
        </div>
        <div className="aqi-badge">
          <span className="aqi-number">
            <span className="aqi-aqhi" title={AQHI_HELP}>
              {formatAqhi(aqhi[fi])}
              <span className="aqi-unit">AQHI</span>
            </span>
            <span className="aqi-alt" title={AQI_HELP}>
              <span className="aqi-alt__paren">(</span>
              <span className="aqi-alt__num">{aqiText}</span> AQI
              <span className="aqi-alt__paren">)</span>
            </span>
          </span>
          <span className="aqi-chip" style={{ background: cat.color }}>
            {cat.label}
          </span>
        </div>
      </header>

      <div className="aqi-tiles">
        {tiles.map((t) => (
          <div className="aqi-tile" key={t.key}>
            <span className="aqi-tile__key">{t.key}</span>
            <span className="aqi-tile__val">
              {Number.isFinite(t.value) ? Math.round(t.value) : "–"}
              <span className="aqi-tile__unit"> {t.unit ?? "µg/m³"}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
