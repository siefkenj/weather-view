import { aqhiCategory, formatAqhi } from "../utils/aqhi";
import { formatDayShort, formatFullDate, formatTime } from "../utils/format";
import { findNowIndex } from "../utils/series";
import type { AirQualityResponse } from "../api/types";

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
            {formatAqhi(aqhi[fi])}
            <span className="aqi-unit">AQHI</span>
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
