import type { ScreenshotReading } from "@potbot/ai";
import { describe, expect, it } from "vitest";
import { checkPayoutScreenshot } from "./payout-check.js";

const reading: ScreenshotReading = {
  isTelebirrReceipt: true,
  successful: true,
  transactionNumber: "abc9ihx0g5",
  transactionTo: "Yabets",
  transactionTime: "2026/11/10 15:00:00",
  amount: 903,
};
const context = {
  share: 900,
  notBefore: new Date("2026-11-06T18:30:00Z"),
  timeZone: "Africa/Addis_Ababa",
  now: new Date("2026-11-10T13:00:00Z"),
};
const check = (overrides: Partial<ScreenshotReading> = {}) =>
  checkPayoutScreenshot({ ...reading, ...overrides }, context);

describe("checkPayoutScreenshot", () => {
  it("accepts a successful transfer covering the share, whatever name Telebirr shows", () => {
    expect(check()).toEqual({
      kind: "accepted",
      txnId: "ABC9IHX0G5",
      paidAt: new Date("2026-11-10T12:00:00.000Z"),
      receiver: "Yabets",
    });
    expect(check({ transactionTo: null })).toMatchObject({ kind: "accepted", receiver: null });
  });

  it("refuses an image that isn't a receipt", () => {
    expect(check({ isTelebirrReceipt: false })).toEqual({ kind: "not_receipt" });
  });

  it("refuses a failed transfer", () => {
    expect(check({ successful: false })).toEqual({ kind: "failed" });
  });

  it("refuses less than the share", () => {
    expect(check({ amount: 899.99 })).toEqual({ kind: "short", amount: 899.99 });
  });

  it("refuses a transfer from before the gameweek's deadline, like an old screenshot", () => {
    expect(check({ transactionTime: "2026/11/06 21:00:00" })).toEqual({ kind: "too_early" });
  });

  it("refuses a time in the future", () => {
    expect(check({ transactionTime: "2026/11/12 12:00:00" })).toEqual({ kind: "unreadable" });
  });

  it.each([
    [{ transactionNumber: null }],
    [{ transactionTime: null }],
    [{ transactionTime: "soon" }],
    [{ amount: null }],
    [{ transactionNumber: "a!" }],
  ])("can't accept with %j", (overrides) => {
    expect(check(overrides)).toEqual({ kind: "unreadable" });
  });
});
