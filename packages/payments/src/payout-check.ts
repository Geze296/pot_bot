import type { ScreenshotReading } from "@potbot/ai";
import { amountCovers, parseLocalTime } from "./screenshot-check.js";

const CLOCK_SLACK_MS = 10 * 60 * 1000;

export type PayoutDecision =
  | { kind: "accepted"; txnId: string; paidAt: Date; receiver: string | null }
  | { kind: "not_receipt" | "failed" | "too_early" | "unreadable" }
  | { kind: "short"; amount: number };

/**
 * Checks a coordinator's proof of sending a winner their share. The receiver isn't checked, because a winner's
 * Telebirr name needn't match their FPL name. It's shown to the group instead, along with the screenshot.
 */
export function checkPayoutScreenshot(
  reading: ScreenshotReading,
  context: { share: number; notBefore: Date; timeZone: string; now: Date },
): PayoutDecision {
  if (!reading.isTelebirrReceipt) return { kind: "not_receipt" };
  if (!reading.successful) return { kind: "failed" };

  const txnId = reading.transactionNumber?.trim().toUpperCase();
  const paidAt = reading.transactionTime ? parseLocalTime(reading.transactionTime, context.timeZone) : null;
  if (!txnId || !/^[A-Z0-9]{6,20}$/.test(txnId) || !paidAt || reading.amount === null) return { kind: "unreadable" };
  if (paidAt.getTime() > context.now.getTime() + CLOCK_SLACK_MS) return { kind: "unreadable" };

  if (!amountCovers(reading.amount, context.share)) return { kind: "short", amount: reading.amount };
  if (paidAt < context.notBefore) return { kind: "too_early" };
  return { kind: "accepted", txnId, paidAt, receiver: reading.transactionTo };
}
