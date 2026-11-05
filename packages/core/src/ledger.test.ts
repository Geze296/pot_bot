import { describe, expect, it } from "vitest";
import { memberLedger } from "./ledger.js";

describe("memberLedger", () => {
  it("adds paid in and won per member, and works out the net", () => {
    const ledger = memberLedger({
      payments: [
        { memberId: 1, amount: 100 },
        { memberId: 1, amount: 100 },
        { memberId: 2, amount: 100 },
      ],
      payouts: [{ memberId: 2, amount: 900 }],
    });

    expect(ledger).toEqual([
      { memberId: 1, paidIn: 200, won: 0, net: -200 },
      { memberId: 2, paidIn: 100, won: 900, net: 800 },
    ]);
  });

  it("is empty with no money", () => {
    expect(memberLedger({ payments: [], payouts: [] })).toEqual([]);
  });
});
