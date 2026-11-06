export function dateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
}

/** Rounded down, so it never promises more time than there is. Null once the time has passed. */
export function timeLeft(iso: string, now: Date): TimeLeft | null {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes / 60) % 24, minutes: minutes % 60 };
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** An audit entry's change as "label: old → new" lines, leaving out anything that stayed the same. */
export function changes(before: unknown, after: unknown, labelOf: (key: string) => string = (key) => key): string[] {
  const asRecord = (value: unknown) =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const show = (value: unknown) => (value === undefined || value === null || value === "" ? "–" : String(value));
  const [was, now] = [asRecord(before), asRecord(after)];
  return [...new Set([...Object.keys(was), ...Object.keys(now)])]
    .filter((key) => show(was[key]) !== show(now[key]))
    .map((key) => {
      const label = labelOf(key);
      // Something added has no "before" worth showing.
      return show(was[key]) === "–" ? `${label}: ${show(now[key])}` : `${label}: ${show(was[key])} → ${show(now[key])}`;
    });
}

/** Who holds a record, with ties sharing it. Nobody holds a record of zero. */
export function leaders<T>(rows: T[], valueOf: (row: T) => number): { rows: T[]; value: number } | null {
  const value = Math.max(0, ...rows.map(valueOf));
  return value > 0 ? { rows: rows.filter((row) => valueOf(row) === value), value } : null;
}
