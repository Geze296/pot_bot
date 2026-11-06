import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, parseRules, RuleError, setRule } from "./rules.js";

describe("DEFAULT_RULES", () => {
  it("matches our group", () => {
    expect(DEFAULT_RULES).toEqual({
      entryFee: 100,
      prizeShares: [100],
      runnerUpPerk: "skip_next",
      winnerPerk: "skip_next",
      whoCanWin: "paid_only",
      scoreMode: "net",
      tieFirst: "split",
      tieSecond: "all",
      lateRule: "not_eligible",
      lateFee: 120,
    });
  });
});

describe("parseRules", () => {
  it("fills in anything missing, so older leagues keep working", () => {
    expect(parseRules({ entryFee: 50 })).toEqual({ ...DEFAULT_RULES, entryFee: 50 });
  });
});

describe("setRule", () => {
  it.each([
    ["entryFee", "50", { entryFee: 50 }],
    ["lateFee", "150", { lateFee: 150 }],
    ["prizeShares", "70,30", { prizeShares: [70, 30] }],
    ["runnerUpPerk", "half_price", { runnerUpPerk: "half_price" }],
    ["winnerPerk", "off", { winnerPerk: "off" }],
    ["whoCanWin", "everyone", { whoCanWin: "everyone" }],
    ["scoreMode", "gross", { scoreMode: "gross" }],
    ["tieFirst", "tie_break", { tieFirst: "tie_break" }],
    ["tieSecond", "tie_break", { tieSecond: "tie_break" }],
    ["lateRule", "late_fee", { lateRule: "late_fee" }],
  ])("sets %s to %s", (key, value, expected) => {
    expect(setRule(DEFAULT_RULES, key, value)).toEqual({ ...DEFAULT_RULES, ...expected });
  });

  it.each([
    ["nonsense", "1"],
    ["entryFee", "-5"],
    ["entryFee", "10.5"],
    ["entryFee", "abc"],
    ["prizeShares", "70,20"],
    ["prizeShares", "100,0.5"],
    ["runnerUpPerk", "double_or_nothing"],
    ["scoreMode", "whatever"],
  ])("rejects %s = %s", (key, value) => {
    expect(() => setRule(DEFAULT_RULES, key, value)).toThrow(RuleError);
  });

  it("doesn't change the rules it was given", () => {
    const rules = { ...DEFAULT_RULES };
    setRule(rules, "entryFee", "50");
    expect(rules.entryFee).toBe(100);
  });
});
