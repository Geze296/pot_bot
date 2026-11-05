import { describe, expect, it } from "vitest";
import { applyDeadline, buildObligations, potFromObligations } from "./obligations.js";
import { DEFAULT_RULES } from "./rules.js";

describe("buildObligations", () => {
  it("charges the entry fee, and a free pass is 0 and already paid", () => {
    expect(buildObligations({ rules: DEFAULT_RULES, memberIds: [1, 2], freePassIds: [2] })).toEqual([
      { memberId: 1, amountDue: 100, reason: "entry", status: "due" },
      { memberId: 2, amountDue: 0, reason: "free_pass", status: "paid" },
    ]);
  });

  it("half price rounds down to whole birr", () => {
    const rules = { ...DEFAULT_RULES, entryFee: 75 };
    expect(buildObligations({ rules, memberIds: [1], halfPriceIds: [1] })).toEqual([
      { memberId: 1, amountDue: 37, reason: "entry", status: "due" },
    ]);
  });
});

describe("applyDeadline", () => {
  const unpaid = { amountDue: 100, reason: "entry" as const, status: "due" as const };

  it("not eligible (our rule): an unpaid fee is waived", () => {
    expect(applyDeadline(DEFAULT_RULES, unpaid)).toEqual({ ...unpaid, status: "waived" });
  });

  it("late fee: the amount rises and stays due", () => {
    const rules = { ...DEFAULT_RULES, lateRule: "late_fee" as const, lateFee: 120 };
    expect(applyDeadline(rules, unpaid)).toEqual({ amountDue: 120, reason: "late_fee", status: "due" });
  });

  it("lose free pass: stays due at the normal fee", () => {
    expect(applyDeadline({ ...DEFAULT_RULES, lateRule: "lose_free_pass" }, unpaid)).toEqual(unpaid);
  });

  it("leaves paid obligations alone", () => {
    const paid = { ...unpaid, status: "paid" as const };
    expect(applyDeadline(DEFAULT_RULES, paid)).toEqual(paid);
  });
});

describe("potFromObligations", () => {
  it("is 9 x 100 for the classic 10-player week with a free pass", () => {
    const obligations = [
      ...Array.from({ length: 9 }, () => ({ amountDue: 100, status: "paid" as const })),
      { amountDue: 0, status: "paid" as const },
    ];
    expect(potFromObligations(obligations, 0)).toBe(900);
  });

  it("counts only paid fees and adds what carried in", () => {
    const obligations = [
      { amountDue: 100, status: "paid" as const },
      { amountDue: 100, status: "due" as const },
      { amountDue: 100, status: "waived" as const },
    ];
    expect(potFromObligations(obligations, 2)).toBe(102);
  });
});
