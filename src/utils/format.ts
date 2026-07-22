// Open-Meteo returns timezone-local ISO strings without an offset (e.g.
// "2026-07-22T14:00"). `new Date(iso)` parses those as browser-local wall-clock,
// and Intl formatting reads them back in the same zone, so the displayed digits
// match the location's local time. We deliberately do NOT re-apply a timezone.

export function parseLocal(iso: string): Date {
  return new Date(iso);
}

export function formatDayShort(iso: string): string {
  const d = parseLocal(iso);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday} ${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatWeekday(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, { weekday: "short" });
}

export function formatMonthDay(iso: string): string {
  const d = parseLocal(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatHour(iso: string): string {
  return parseLocal(iso).toLocaleTimeString(undefined, { hour: "numeric" });
}

export function formatTime(iso: string): string {
  return parseLocal(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatFullDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** YYYY-MM-DD key for a local ISO timestamp (first 10 chars are already local). */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Today's YYYY-MM-DD in the given IANA timezone (falls back to browser zone). */
export function todayInZone(timezone?: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA yields YYYY-MM-DD
}
