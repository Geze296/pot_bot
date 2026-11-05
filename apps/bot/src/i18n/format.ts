import { t, type Language } from "./index.js";

/** Times are stored in UTC and shown in the league's time zone (hard rule 1). */
export function formatLocalTime(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(moment);
}

/** Rounded down, so it never promises more time than there is. */
export function formatTimeLeft(language: Language, ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return t(language, "time.daysHours", { days, hours: hours - days * 24 });
  if (hours > 0) return t(language, "time.hoursMinutes", { hours, minutes: minutes - hours * 60 });
  return t(language, "time.minutes", { minutes });
}
