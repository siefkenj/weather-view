import { WIND_ARROW_GLYPH, windArrowRotation } from "../utils/wind";

/** A long arrow rotated to the exact wind bearing (points back toward the source,
 *  like a weathervane). Decorative — the compass abbreviation beside it carries the
 *  direction for screen readers. Renders nothing for an unknown bearing. */
export function WindArrow({ deg, className }: { deg: number | null | undefined; className?: string }) {
  const rot = windArrowRotation(deg);
  if (rot == null) return null;
  return (
    <span
      className={`wind-arrow${className ? ` ${className}` : ""}`}
      style={{ transform: `rotate(${rot}deg)` }}
      aria-hidden="true"
    >
      {WIND_ARROW_GLYPH}
    </span>
  );
}
