// Dependency-free weather icons drawn as inline SVG, keyed by WMO icon category.
// Kept simple and legible at small sizes for the daily strip.

import type { IconKind } from "../api/weatherCode";

interface Props {
  kind: IconKind;
  night?: boolean;
  size?: number;
  title?: string;
  className?: string;
}

const SUN = "#f7b733";
const MOON = "#cdd6f4";
const CLOUD = "#c3ccd8";
const CLOUD_DARK = "#8b97a8";
const RAIN = "#3b9ae1";
const SNOW = "#cfe8ff";
const BOLT = "#f4c430";
const FOG = "#a9b4c2";

function Sun({ cx = 24, cy = 24, r = 10 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i;
    const x1 = cx + Math.cos(a) * (r + 4);
    const y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9);
    const y2 = cy + Math.sin(a) * (r + 9);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={SUN} strokeWidth={2.4} strokeLinecap="round" />;
  });
  return (
    <g>
      {rays}
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
    </g>
  );
}

function Moon({ cx = 24, cy = 22 }: { cx?: number; cy?: number }) {
  return (
    <path
      d={`M ${cx + 7} ${cy + 8} a 10 10 0 1 1 -9 -15 a 8 8 0 0 0 9 15 Z`}
      fill={MOON}
      stroke="#94a3c4"
      strokeWidth={0.5}
    />
  );
}

function Cloud({ fill = CLOUD, y = 30 }: { fill?: string; y?: number }) {
  return (
    <g fill={fill}>
      <circle cx={22} cy={y} r={10} />
      <circle cx={34} cy={y - 5} r={13} />
      <circle cx={45} cy={y} r={10} />
      <rect x={20} y={y} width={26} height={12} rx={6} />
    </g>
  );
}

function Drops({ color = RAIN, count = 3 }: { color?: string; count?: number }) {
  const xs = count === 3 ? [22, 32, 42] : [26, 38];
  return (
    <g stroke={color} strokeWidth={3} strokeLinecap="round">
      {xs.map((x, i) => (
        <line key={i} x1={x} y1={46} x2={x - 3} y2={54} />
      ))}
    </g>
  );
}

function Flakes({ color = "#7fb2e6" }: { color?: string }) {
  return (
    <g fill={color}>
      {[24, 34, 44].map((x, i) => (
        <circle key={i} cx={x} cy={50} r={2.4} />
      ))}
    </g>
  );
}

function Bolt() {
  return <path d="M34 42 L26 54 L32 54 L28 62 L40 48 L33 48 L38 42 Z" fill={BOLT} />;
}

function FogLines() {
  return (
    <g stroke={FOG} strokeWidth={3} strokeLinecap="round">
      <line x1={16} y1={44} x2={48} y2={44} />
      <line x1={18} y1={50} x2={46} y2={50} />
      <line x1={16} y1={56} x2={44} y2={56} />
    </g>
  );
}

function renderKind(kind: IconKind, night: boolean) {
  const orb = night ? <Moon /> : <Sun />;
  switch (kind) {
    case "clear":
    case "mainly-clear":
      return orb;
    case "partly-cloudy":
      return (
        <>
          {night ? <Moon cx={20} cy={20} /> : <Sun cx={20} cy={20} r={8} />}
          <Cloud y={34} />
        </>
      );
    case "overcast":
      return (
        <>
          <Cloud fill={CLOUD_DARK} y={26} />
          <Cloud fill={CLOUD} y={34} />
        </>
      );
    case "fog":
      return (
        <>
          <Cloud y={26} />
          <FogLines />
        </>
      );
    case "drizzle":
      return (
        <>
          <Cloud />
          <Drops count={2} />
        </>
      );
    case "rain":
    case "rain-showers":
      return (
        <>
          <Cloud />
          <Drops count={3} />
        </>
      );
    case "freezing-rain":
      return (
        <>
          <Cloud />
          <Drops count={2} />
          <Flakes color="#a9c8ec" />
        </>
      );
    case "snow":
    case "snow-showers":
    case "snow-grains":
      return (
        <>
          <Cloud />
          <Flakes color={SNOW} />
        </>
      );
    case "thunderstorm":
    case "thunderstorm-hail":
      return (
        <>
          <Cloud fill={CLOUD_DARK} />
          <Bolt />
        </>
      );
    default:
      return <Cloud />;
  }
}

export function WeatherIcon({ kind, night = false, size = 48, title, className }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? kind}
    >
      {title ? <title>{title}</title> : null}
      {renderKind(kind, night)}
    </svg>
  );
}
