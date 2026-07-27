// Skeleton placeholders shown while data loads. Rather than a "Loading … data"
// message, we render the page's shape with shimmering blocks so the layout is
// present immediately and fills in as each independent query resolves.

function Sk({
  w,
  h,
  r,
  className,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  className?: string;
}) {
  return (
    <span
      className={"skeleton" + (className ? " " + className : "")}
      style={{ width: w, height: h, borderRadius: r }}
    />
  );
}

/** Shape of the current-conditions hero. */
function HeroSkeleton() {
  return (
    <div className="current current--skeleton">
      <div className="current__meta">
        <Sk w={150} h={16} />
        <div className="current__main sk-mt">
          <Sk w={60} h={60} r={12} />
          <div>
            <Sk w={118} h={44} />
            <Sk w={92} h={14} className="sk-mt" />
          </div>
        </div>
        <Sk w={200} h={14} className="sk-mt" />
      </div>
      <Sk w={230} h={72} r={12} className="sk-hide-narrow" />
    </div>
  );
}

/** Air-quality panel placeholder (tiles + a chart block). */
export function AirPanelSkeleton() {
  return (
    <div className="panel" aria-busy="true">
      <Sk w={130} h={18} />
      <div className="sk-tiles sk-mt">
        {Array.from({ length: 4 }).map((_, i) => (
          <Sk key={i} h={62} r={10} />
        ))}
      </div>
      <Sk h={150} r={12} className="sk-mt" />
    </div>
  );
}

/** Radar panel placeholder — map area + options sidebar (matches the real layout). */
export function RadarSkeleton() {
  return (
    <div className="panel radar-panel" aria-busy="true">
      <div className="radar-map-wrap">
        <Sk className="sk-radar-map" />
      </div>
      <div className="radar-options">
        <div className="radar-options__group">
          <Sk w={54} h={11} />
          <Sk w={120} h={16} className="sk-mt" />
          <Sk w={120} h={16} />
          <Sk w={120} h={16} />
        </div>
        <div className="radar-options__group">
          <Sk w={70} h={11} />
          <div className="radar-playback">
            <Sk w={36} h={36} r={18} />
            <Sk w={84} h={16} />
          </div>
          <Sk h={14} className="sk-mt" />
        </div>
      </div>
    </div>
  );
}

/** Full-dashboard placeholder shown while the forecast is loading. */
export function DashboardSkeleton() {
  return (
    <div className="dashboard" aria-busy="true">
      <span className="sk-sr">Loading weather…</span>
      <HeroSkeleton />
      <div className="panel meteogram-panel" aria-hidden="true">
        <Sk w={170} h={20} />
        <Sk h={340} r={12} className="sk-mt" />
      </div>
      <AirPanelSkeleton />
      <RadarSkeleton />
    </div>
  );
}
