import { WIND_ARROW_GLYPH, WIND_ARROW_TITLE, windArrowRotation } from "../utils/wind";

/** A long arrow rotated to point the way the wind is blowing — the direction a balloon
 *  would be pushed (not a weathervane pointing back at the source). Decorative — the
 *  compass abbreviation beside it carries the direction for screen readers — but it
 *  carries the convention as hover `title` text. Renders nothing for an unknown bearing. */
export function WindArrow({
  deg,
  className,
  title = WIND_ARROW_TITLE,
}: {
  deg: number | null | undefined;
  className?: string;
  title?: string;
}) {
  const rot = windArrowRotation(deg);
  if (rot == null) return null;
  return (
    <span
      className={`wind-arrow${className ? ` ${className}` : ""}`}
      style={{ transform: `rotate(${rot}deg)` }}
      title={title}
      aria-hidden="true"
    >
      {WIND_ARROW_GLYPH}
    </span>
  );
}
