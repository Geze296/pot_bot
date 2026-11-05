import type { ScreenshotReading } from "@potbot/ai";
import { describe, expect, it } from "vitest";
import { amountCovers, checkScreenshot, parseLocalTime, receiverMatches } from "./screenshot-check.js";

const ADDIS = "Africa/Addis_Ababa";

// What Gemini read from a real screenshot, with the transaction number changed.
const reading: ScreenshotReading = {
  isTelebirrReceipt: true,
  successful: true,
  transactionNumber: "ABC9IHX0G5",
  transactionTo: "Kibrom",
  transactionTime: "2026/10/31 11:04:01",
  amount: 101,
};
const context = { expectedReceiver: "Kibrom", timeZone: ADDIS, now: new Date("2026-11-01T00:00:00Z") };
const check = (overrides: Partial<ScreenshotReading> = {}, contextOverrides = {}) =>
  checkScreenshot({ ...reading, ...overrides }, { ...context, ...contextOverrides });

describe("parseLocalTime", () => {
  it("reads a screenshot's time in the league's time zone", () => {
    expect(parseLocalTime("2026/10/31 11:04:01", ADDIS)?.toISOString()).toBe("2026-10-31T08:04:01.000Z");
  });

  it("handles a time zone with daylight saving", () => {
    expect(parseLocalTime("2026/07/01 12:00:00", "Europe/London")?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(parseLocalTime("2026/01/01 12:00:00", "Europe/London")?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it.each([
    "",
    "yesterday",
    "2026/13/01 10:00:00",
    "2026/02/30 10:00:00",
    "2026/10/31 25:00:00",
    "31/10/2026 10:00:00",
  ])("rejects %j", (text) => {
    expect(parseLocalTime(text, ADDIS)).toBeNull();
  });
});

describe("receiverMatches", () => {
  it.each([
    ["Kibrom", "Kibrom"],
    ["kibrom", "KIBROM"],
    [" Kibrom ", "Kibrom"],
    ["Kibrom Tesfaye", "Kibrom"],
    ["Kibrom", "Kibrom Tesfaye"],
  ])("accepts %j and %j", (expected, shown) => {
    expect(receiverMatches(expected, shown)).toBe(true);
  });

  it.each([
    ["Kibrom", "Abel"],
    ["Kibrom", "Kib"],
    ["Kibrom Tesfaye", "Kibrom Abel"],
    ["Kibrom", ""],
  ])("refuses %j and %j", (expected, shown) => {
    expect(receiverMatches(expected, shown)).toBe(false);
  });
});

describe("amountCovers", () => {
  it("accepts the fee, or more because Telebirr's charge is included", () => {
    expect(amountCovers(100, 100)).toBe(true);
    expect(amountCovers(101, 100)).toBe(true);
    expect(amountCovers(102.01, 100)).toBe(true);
  });

  it("refuses less than the fee, including by a fraction", () => {
    expect(amountCovers(99.99, 100)).toBe(false);
  });
});

describe("checkScreenshot", () => {
  it("accepts a real successful screenshot", () => {
    expect(check()).toEqual({
      kind: "accepted",
      txnId: "ABC9IHX0G5",
      amount: 101,
      paidAt: new Date("2026-10-31T08:04:01.000Z"),
    });
  });

  it("normalises the transaction number, so case can't dodge the reuse check", () => {
    expect(check({ transactionNumber: " abc9ihx0g5 " })).toMatchObject({ txnId: "ABC9IHX0G5" });
  });

  it("doesn't consider an image that isn't a receipt", () => {
    expect(check({ isTelebirrReceipt: false })).toEqual({ kind: "not_receipt" });
  });

  it("rejects a failed transaction", () => {
    expect(check({ successful: false })).toEqual({ kind: "rejected", reason: "failed" });
  });

  it("rejects a payment to someone else", () => {
    expect(check({ transactionTo: "Abel" })).toEqual({ kind: "rejected", reason: "wrong_receiver" });
  });

  it.each([
    ["transactionNumber", { transactionNumber: null }],
    ["transactionTo", { transactionTo: null }],
    ["transactionTime", { transactionTime: null }],
    ["amount", { amount: null }],
    ["an unreadable time", { transactionTime: "soon" }],
    ["a malformed transaction number", { transactionNumber: "ab!" }],
  ])("sends a receipt missing %s to the coordinator", (_name, overrides) => {
    expect(check(overrides)).toMatchObject({ kind: "review", reason: "unreadable" });
  });

  it("sends a time well in the future to the coordinator", () => {
    expect(check({ transactionTime: "2026/11/02 12:00:00" })).toMatchObject({ kind: "review", reason: "future_date" });
  });

  it("allows a phone clock a few minutes ahead", () => {
    expect(check({ transactionTime: "2026/11/01 03:05:00" }).kind).toBe("accepted");
  });

  it("sends everything to the coordinator until the receiver name is set", () => {
    expect(check({}, { expectedReceiver: null })).toMatchObject({ kind: "review", reason: "receiver_not_set" });
  });

  it("passes what it could read along for review", () => {
    expect(check({ transactionTo: null })).toEqual({
      kind: "review",
      reason: "unreadable",
      txnId: "ABC9IHX0G5",
      amount: 101,
      paidAt: new Date("2026-10-31T08:04:01.000Z"),
    });
  });
});
