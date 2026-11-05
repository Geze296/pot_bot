import type { ScreenshotReading } from "@potbot/ai";

/** Phone clocks drift a little, so a time just ahead of ours is fine. */
const CLOCK_SLACK_MS = 10 * 60 * 1000;

export interface ScreenshotContext {
  /** The Telebirr name the admin provided. */
  expectedReceiver: string | null;
  timeZone: string;
  now: Date;
}

export type ReviewReason = "unreadable" | "future_date" | "receiver_not_set" | "ai_unavailable";

export type ScreenshotDecision =
  | { kind: "accepted"; txnId: string; amount: number; paidAt: Date }
  | { kind: "not_receipt" }
  | { kind: "rejected"; reason: "failed" | "wrong_receiver" }
  | { kind: "review"; reason: ReviewReason; txnId?: string; amount?: number; paidAt?: Date };

/** How far the zone is ahead of UTC at a moment, in milliseconds. */
function zoneOffsetMs(moment: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(moment);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - moment.getTime();
}

/** Screenshots show local time with no time zone, like "2026/10/31 11:04:01". */
export function parseLocalTime(text: string, timeZone: string): Date | null {
  const match = text.trim().match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls over bad values such as 30 February, so a changed value means the date wasn't real.
  const isReal =
    asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day && asUtc.getUTCHours() === hour && minute < 60;
  if (!isReal) return null;

  return new Date(asUtc.getTime() - zoneOffsetMs(asUtc, timeZone));
}

const nameWords = (name: string) => name.toLowerCase().split(/\s+/).filter(Boolean);

/** Telebirr may show only a first name, so one name's words must all appear in the other's. */
export function receiverMatches(expected: string, shown: string): boolean {
  const [a, b] = [nameWords(expected), nameWords(shown)];
  if (a.length === 0 || b.length === 0) return false;
  return a.every((word) => b.includes(word)) || b.every((word) => a.includes(word));
}

/** The amount on a screenshot includes Telebirr's own fee, so it only has to reach what's due. */
export function amountCovers(amount: number, due: number): boolean {
  return amount >= due;
}

/** Decides what a reading means. The amount is checked later, when the gameweek it pays for is known. */
export function checkScreenshot(reading: ScreenshotReading, context: ScreenshotContext): ScreenshotDecision {
  if (!reading.isTelebirrReceipt) return { kind: "not_receipt" };
  if (!reading.successful) return { kind: "rejected", reason: "failed" };

  const txnId = reading.transactionNumber?.trim().toUpperCase();
  const validTxn = txnId && /^[A-Z0-9]{6,20}$/.test(txnId) ? txnId : undefined;
  const paidAt = reading.transactionTime ? parseLocalTime(reading.transactionTime, context.timeZone) : null;
  const known = {
    ...(validTxn ? { txnId: validTxn } : {}),
    ...(reading.amount !== null ? { amount: reading.amount } : {}),
    ...(paidAt ? { paidAt } : {}),
  };

  if (context.expectedReceiver === null) return { kind: "review", reason: "receiver_not_set", ...known };
  if (reading.transactionTo && !receiverMatches(context.expectedReceiver, reading.transactionTo)) {
    return { kind: "rejected", reason: "wrong_receiver" };
  }
  if (!validTxn || !paidAt || reading.amount === null || !reading.transactionTo) {
    return { kind: "review", reason: "unreadable", ...known };
  }
  if (paidAt.getTime() > context.now.getTime() + CLOCK_SLACK_MS) {
    return { kind: "review", reason: "future_date", ...known };
  }
  return { kind: "accepted", txnId: validTxn, amount: reading.amount, paidAt };
}
