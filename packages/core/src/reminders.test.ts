import { describe, expect, it } from "vitest";
import { currentReminderRound, REMINDER_ROUNDS } from "./reminders.js";

const DEADLINE = new Date("2026-11-06T18:30:00Z");
const before = (minutes: number) => new Date(DEADLINE.getTime() - minutes * 60 * 1000);

describe("REMINDER_ROUNDS", () => {
  it("is once with 2 days left, twice with 1 day left, four times on deadline day", () => {
    expect(REMINDER_ROUNDS.map((round) => round.key)).toEqual(["48h", "24h", "18h", "6h", "3h", "1h", "15m"]);
  });

  it("gets sassier toward the deadline", () => {
    expect(REMINDER_ROUNDS.map((round) => round.tone)).toEqual([
      "polite",
      "cheeky",
      "cheeky",
      "urgent",
      "urgent",
      "urgent",
      "urgent",
    ]);
  });
});

describe("currentReminderRound", () => {
  it("has no round before 48 hours", () => {
    expect(currentReminderRound(DEADLINE, before(48 * 60 + 1))).toBeNull();
  });

  it.each([
    [48 * 60, "48h"],
    [24 * 60 + 1, "48h"],
    [24 * 60, "24h"],
    [18 * 60, "18h"],
    [7 * 60, "18h"],
    [6 * 60, "6h"],
    [3 * 60, "3h"],
    [60, "1h"],
    [15, "15m"],
    [1, "15m"],
  ])("%i minutes before the deadline is round %s", (minutes, key) => {
    expect(currentReminderRound(DEADLINE, before(minutes))?.key).toBe(key);
  });

  it("has no round at or after the deadline", () => {
    expect(currentReminderRound(DEADLINE, DEADLINE)).toBeNull();
    expect(currentReminderRound(DEADLINE, before(-1))).toBeNull();
  });
});
