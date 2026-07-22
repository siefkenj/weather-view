import { usAqiCategory } from "../utils/aqi";
import { findNowIndex } from "../utils/series";
import type { AirQualityResponse } from "../api/types";

interface Props {
  data: AirQualityResponse;
  nowIso: string;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="sparkline" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AirQualityPanel({ data, nowIso }: Props) {
  const h = data.hourly;
  const i = Math.max(0, findNowIndex(h.time, nowIso));
  const units = data.hourly_units;

  const usAqi = h.us_aqi?.[i];
  const cat = usAqiCategory(usAqi);
  const meterPct = Math.min(100, ((usAqi ?? 0) / 300) * 100);

  const tiles = [
    { key: "PM2.5", value: h.pm2_5?.[i], unit: units.pm2_5 },
    { key: "PM10", value: h.pm10?.[i], unit: units.pm10 },
    { key: "Ozone", value: h.ozone?.[i], unit: units.ozone },
    { key: "NO₂", value: h.nitrogen_dioxide?.[i], unit: units.nitrogen_dioxide },
  ];

  return (
    <section className="panel air-quality" aria-label="Air quality">
      <header className="panel__head">
        <h2>Air quality</h2>
        <span className="aqi-chip" style={{ background: cat.color }}>
          {cat.label}
        </span>
      </header>

      <div className="aqi-hero">
        <div className="aqi-number">
          {Number.isFinite(usAqi) ? Math.round(usAqi) : "–"}
          <span className="aqi-unit">US AQI</span>
        </div>
        <div className="aqi-meter" aria-hidden="true">
          <div className="aqi-meter__fill" style={{ width: `${meterPct}%`, background: cat.color }} />
        </div>
        <Sparkline values={h.us_aqi ?? []} color={cat.color} />
      </div>

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
