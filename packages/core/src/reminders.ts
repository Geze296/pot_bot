export type ReminderTone = "polite" | "cheeky" | "urgent";

export interface ReminderRound {
  key: string;
  minutesBefore: number;
  tone: ReminderTone;
}

/** The owner's schedule: once with 2 days left, twice with 1 day left, four times on deadline day. Earliest first. */
export const REMINDER_ROUNDS: ReminderRound[] = [
  { key: "48h", minutesBefore: 48 * 60, tone: "polite" },
  { key: "24h", minutesBefore: 24 * 60, tone: "cheeky" },
  { key: "18h", minutesBefore: 18 * 60, tone: "cheeky" },
  { key: "6h", minutesBefore: 6 * 60, tone: "urgent" },
  { key: "3h", minutesBefore: 3 * 60, tone: "urgent" },
  { key: "1h", minutesBefore: 60, tone: "urgent" },
  { key: "15m", minutesBefore: 15, tone: "urgent" },
];

/** The most recent round that has started. A round missed while the bot was down is simply skipped. */
export function currentReminderRound(deadline: Date, now: Date): ReminderRound | null {
  if (now >= deadline) return null;
  const minutesLeft = (deadline.getTime() - now.getTime()) / 60_000;
  return REMINDER_ROUNDS.filter((round) => minutesLeft <= round.minutesBefore).at(-1) ?? null;
}
