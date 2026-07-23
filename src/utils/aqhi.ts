// Canada's Air Quality Health Index (AQHI). Environment and Climate Change
// Canada computes it from 3-hour moving averages of ground-level ozone (O₃),
// nitrogen dioxide (NO₂) and fine particulates (PM2.5). Open-Meteo reports O₃/NO₂
// in µg/m³, so we convert to ppb first. Categories & wording per ECCC:
// https://www.canada.ca/en/environment-climate-change/services/air-quality-health-index/about.html

export interface AqhiCategory {
  /** Official ECCC category wording. */
  label: string;
  /** One-word form for compact chips. */
  short: string;
  color: string;
  /** Brief health advice. */
  message: string;
}

const LOW: AqhiCategory = {
  label: "Low health risk",
  short: "Low",
  color: "#0a9cd6",
  message: "Ideal air quality for outdoor activities.",
};
const MODERATE: AqhiCategory = {
  label: "Moderate health risk",
  short: "Moderate",
  color: "#f0a02c",
  message: "No need to modify activities unless you notice symptoms.",
};
const HIGH: AqhiCategory = {
  label: "High health risk",
  short: "High",
  color: "#e5391f",
  message: "Consider reducing or rescheduling strenuous activities outdoors.",
};
const VERY_HIGH: AqhiCategory = {
  label: "Very high health risk",
  short: "Very high",
  color: "#7a1204",
  message: "Reduce or reschedule strenuous activities outdoors.",
};

export function aqhiCategory(aqhi: number | null | undefined): AqhiCategory {
  const v = aqhi == null || !Number.isFinite(aqhi) ? 1 : aqhi;
  if (v <= 3) return LOW;
  if (v <= 6) return MODERATE;
  if (v <= 10) return HIGH;
  return VERY_HIGH;
}

/** AQHI is reported as an integer 1–10, with anything above shown as "10+". */
export function formatAqhi(aqhi: number | null | undefined): string {
  if (aqhi == null || !Number.isFinite(aqhi)) return "–";
  return aqhi > 10 ? "10+" : String(Math.round(aqhi));
}

// µg/m³ → ppb at 25 °C, 1 atm: ppb = µg/m³ × 24.45 / molarMass.
const O3_TO_PPB = 24.45 / 48.0; // ozone, 48.00 g/mol
const NO2_TO_PPB = 24.45 / 46.01; // nitrogen dioxide, 46.01 g/mol

export interface AqhiInput {
  ozone: number[]; // µg/m³
  nitrogen_dioxide: number[]; // µg/m³
  pm2_5: number[]; // µg/m³
}

/**
 * Per-hour AQHI aligned to the input hours (rounded, ≥1); NaN where inputs are
 * missing. Uses a trailing 3-hour average of each pollutant, per the ECCC method.
 */
export function computeAqhiSeries(input: AqhiInput): number[] {
  const { ozone, nitrogen_dioxide, pm2_5 } = input;
  const n = Math.max(ozone?.length ?? 0, nitrogen_dioxide?.length ?? 0, pm2_5?.length ?? 0);
  const avg3 = (arr: number[], i: number): number => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - 2); k <= i; k++) {
      const v = arr?.[k];
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    return count ? sum / count : NaN;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const o3 = avg3(ozone, i) * O3_TO_PPB;
    const no2 = avg3(nitrogen_dioxide, i) * NO2_TO_PPB;
    const pm = avg3(pm2_5, i);
    if (!Number.isFinite(o3) || !Number.isFinite(no2) || !Number.isFinite(pm)) {
      out.push(NaN);
      continue;
    }
    const raw =
      (1000 / 10.4) *
      (Math.exp(0.000537 * o3) - 1 + (Math.exp(0.000871 * no2) - 1) + (Math.exp(0.000487 * pm) - 1));
    out.push(Math.max(1, Math.round(raw)));
  }
  return out;
}
