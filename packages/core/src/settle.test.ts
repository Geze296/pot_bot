import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type LeagueRules } from "./rules.js";
import { manualOutcome, settleGameweek, type SettleRow } from "./settle.js";

const row = (memberId: number, points: number, transferCost = 0, totalPoints = 0): SettleRow => ({
  memberId,
  points,
  transferCost,
  totalPoints,
});
const everyone = (rows: SettleRow[]) => rows.map((r) => r.memberId);
const settle = (rows: SettleRow[], overrides: Partial<LeagueRules> = {}, pot = 1000, eligibleIds = everyone(rows)) =>
  settleGameweek({ rules: { ...DEFAULT_RULES, ...overrides }, rows, eligibleIds, pot });

describe("default rules: winner takes all, and the winner and runner-up skip the next fee", () => {
  it("pays the whole pot to the winner and gives the runner-up a free pass", () => {
    const outcome = settle([row(1, 60), row(2, 70), row(3, 50)]);

    expect(outcome.winnerIds).toEqual([2]);
    expect(outcome.runnerUpIds).toEqual([1]);
    expect(outcome.payouts).toEqual([{ memberId: 2, amount: 1000 }]);
    expect(outcome.carryOut).toBe(0);
    expect(outcome.freePassIds).toEqual([2, 1]);
    expect(outcome.halfPriceIds).toEqual([]);
    expect(outcome.lastPlaceIds).toEqual([3]);
  });

  it("scores after hits", () => {
    const outcome = settle([row(1, 70, 12), row(2, 60)]);

    expect(outcome.winnerIds).toEqual([2]);
  });
});

describe("the winner's free pass", () => {
  it("by default, the winner and runner-up both skip the next fee", () => {
    expect(settle([row(1, 60), row(2, 70), row(3, 50)]).freePassIds).toEqual([2, 1]);
  });

  it("a tie for 1st gives every winner a pass, plus the runner-up", () => {
    expect(settle([row(1, 70), row(2, 70), row(3, 60), row(4, 50)]).freePassIds).toEqual([1, 2, 3]);
  });

  it("a tie for 2nd gives everyone tied a pass, plus the winner", () => {
    expect(settle([row(1, 70), row(2, 60), row(3, 60)]).freePassIds).toEqual([1, 2, 3]);
  });

  it("everyone tied: everyone has a pass", () => {
    expect(settle([row(1, 70), row(2, 70)]).freePassIds).toEqual([1, 2]);
  });

  it("can be turned off", () => {
    expect(settle([row(1, 70), row(2, 60)], { winnerPerk: "off" }).freePassIds).toEqual([2]);
  });

  it("the runner-up's perk can differ, and the winner's pass stands", () => {
    const outcome = settle([row(1, 90), row(2, 80)], { runnerUpPerk: "half_price" });

    expect(outcome.freePassIds).toEqual([1]);
    expect(outcome.halfPriceIds).toEqual([2]);
  });

  it("nobody eligible means no passes", () => {
    expect(settle([row(1, 90)], {}, 100, []).freePassIds).toEqual([]);
  });

  it("a manual result gives the named winners and runners-up their passes", () => {
    const outcome = manualOutcome({ rules: DEFAULT_RULES, winnerIds: [1], runnerUpIds: [2], pot: 800 });

    expect(outcome.freePassIds).toEqual([1, 2]);
  });
});

describe("score mode", () => {
  it("gross ignores hits", () => {
    expect(settle([row(1, 70, 12), row(2, 60)], { scoreMode: "gross" }).winnerIds).toEqual([1]);
  });
});

describe("ties for 1st, split", () => {
  it("2-way: both share, and the runner-up is the next score", () => {
    const outcome = settle([row(1, 70), row(2, 70), row(3, 60)]);

    expect(outcome.winnerIds).toEqual([1, 2]);
    expect(outcome.runnerUpIds).toEqual([3]);
    expect(outcome.payouts).toEqual([
      { memberId: 1, amount: 500 },
      { memberId: 2, amount: 500 },
    ]);
    expect(outcome.carryOut).toBe(0);
  });

  it("3-way: an uneven split carries the leftover birr", () => {
    const outcome = settle([row(1, 70), row(2, 70), row(3, 70), row(4, 60)], {}, 800);

    expect(outcome.payouts.map((payout) => payout.amount)).toEqual([266, 266, 266]);
    expect(outcome.carryOut).toBe(2);
    expect(outcome.runnerUpIds).toEqual([4]);
  });

  it("everyone tied: no runner-up", () => {
    expect(settle([row(1, 70), row(2, 70)]).runnerUpIds).toEqual([]);
  });
});

describe("ties for 1st, tie-break", () => {
  const rules = { tieFirst: "tie_break" } as const;

  it("fewer hits wins, and the loser becomes runner-up", () => {
    const outcome = settle([row(1, 74, 4), row(2, 70, 0), row(3, 60)], rules);

    expect(outcome.winnerIds).toEqual([2]);
    expect(outcome.runnerUpIds).toEqual([1]);
    expect(outcome.payouts).toEqual([{ memberId: 2, amount: 1000 }]);
  });

  it("then the higher overall total wins", () => {
    const outcome = settle([row(1, 70, 0, 500), row(2, 70, 0, 600)], rules);

    expect(outcome.winnerIds).toEqual([2]);
    expect(outcome.runnerUpIds).toEqual([1]);
  });

  it("3-way: orders all three", () => {
    const outcome = settle([row(1, 70, 0, 400), row(2, 70, 0, 600), row(3, 70, 0, 500)], rules);

    expect(outcome.winnerIds).toEqual([2]);
    expect(outcome.runnerUpIds).toEqual([3]);
  });

  it("still splits when hits and totals are equal too", () => {
    const outcome = settle([row(1, 70, 0, 500), row(2, 70, 0, 500)], rules);

    expect(outcome.winnerIds).toEqual([1, 2]);
    expect(outcome.payouts.map((payout) => payout.amount)).toEqual([500, 500]);
  });
});

describe("ties for 2nd", () => {
  it("2-way and 3-way: everyone tied gets a free pass by default, along with the winner", () => {
    expect(settle([row(1, 70), row(2, 60), row(3, 60)]).freePassIds).toEqual([1, 2, 3]);
    expect(settle([row(1, 70), row(2, 60), row(3, 60), row(4, 60)]).freePassIds).toEqual([1, 2, 3, 4]);
  });

  it("tie-break: fewer hits takes the pass alone", () => {
    const outcome = settle([row(1, 70), row(2, 64, 4), row(3, 60)], { tieSecond: "tie_break" });

    expect(outcome.runnerUpIds).toEqual([3]);
    expect(outcome.freePassIds).toEqual([1, 3]);
  });

  it("tie-break: 3-way uses the overall total", () => {
    const outcome = settle([row(1, 70), row(2, 60, 0, 300), row(3, 60, 0, 500), row(4, 60, 0, 400)], {
      tieSecond: "tie_break",
    });

    expect(outcome.runnerUpIds).toEqual([3]);
  });
});

describe("who can win", () => {
  it("paid only: unpaid managers are ignored for both winner and runner-up", () => {
    const rows = [row(1, 90), row(2, 80), row(3, 70), row(4, 60)];
    const outcome = settle(rows, {}, 200, [3, 4]);

    expect(outcome.winnerIds).toEqual([3]);
    expect(outcome.runnerUpIds).toEqual([4]);
    expect(outcome.freePassIds).toEqual([3, 4]);
  });

  it("paid only: an unpaid manager can still be last place, for fun", () => {
    expect(settle([row(1, 90), row(2, 10)], {}, 100, [1]).lastPlaceIds).toEqual([2]);
  });

  it("everyone: an unpaid manager can win", () => {
    const outcome = settle([row(1, 90), row(2, 80)], { whoCanWin: "everyone" }, 100, [2]);

    expect(outcome.winnerIds).toEqual([1]);
    expect(outcome.payouts).toEqual([{ memberId: 1, amount: 100 }]);
  });

  it("nobody eligible: no winner, and the whole pot carries", () => {
    const outcome = settle([row(1, 90), row(2, 80)], {}, 300, []);

    expect(outcome.winnerIds).toEqual([]);
    expect(outcome.runnerUpIds).toEqual([]);
    expect(outcome.payouts).toEqual([]);
    expect(outcome.carryOut).toBe(300);
  });

  it("one eligible: wins with no runner-up", () => {
    const outcome = settle([row(1, 90), row(2, 80)], {}, 100, [2]);

    expect(outcome.winnerIds).toEqual([2]);
    expect(outcome.runnerUpIds).toEqual([]);
  });
});

describe("prize split", () => {
  it("70/30", () => {
    const outcome = settle([row(1, 90), row(2, 80), row(3, 70)], { prizeShares: [70, 30] });

    expect(outcome.payouts).toEqual([
      { memberId: 1, amount: 700 },
      { memberId: 2, amount: 300 },
    ]);
  });

  it("top 3", () => {
    const outcome = settle([row(1, 90), row(2, 80), row(3, 70), row(4, 60)], { prizeShares: [50, 30, 20] });

    expect(outcome.payouts.map((payout) => payout.amount)).toEqual([500, 300, 200]);
  });

  it("tied places pool their shares", () => {
    const outcome = settle([row(1, 90), row(2, 90), row(3, 70)], { prizeShares: [70, 30] });

    expect(outcome.payouts).toEqual([
      { memberId: 1, amount: 500 },
      { memberId: 2, amount: 500 },
    ]);
  });

  it("a tie for 2nd splits 2nd's share, and rounding carries", () => {
    const outcome = settle([row(1, 90), row(2, 80), row(3, 80), row(4, 80)], { prizeShares: [70, 30] }, 1000);

    expect(outcome.payouts.map((payout) => payout.amount)).toEqual([700, 100, 100, 100]);
    expect(outcome.carryOut).toBe(0);

    const uneven = settle([row(1, 90), row(2, 80), row(3, 80), row(4, 80)], { prizeShares: [70, 30] }, 901);
    expect(uneven.payouts.map((payout) => payout.amount)).toEqual([630, 90, 90, 90]);
    expect(uneven.carryOut).toBe(1);
  });

  it("carries the share nobody is there to collect", () => {
    const outcome = settle([row(1, 90)], { prizeShares: [70, 30] });

    expect(outcome.payouts).toEqual([{ memberId: 1, amount: 700 }]);
    expect(outcome.carryOut).toBe(300);
  });

  it("never pays out more than the pot", () => {
    const outcome = settle([row(1, 90), row(2, 80), row(3, 70)], { prizeShares: [50, 30, 20] }, 7);
    const paid = outcome.payouts.reduce((sum, payout) => sum + payout.amount, 0);

    expect(paid + outcome.carryOut).toBe(7);
  });
});

describe("runner-up perk", () => {
  const rows = [row(1, 90), row(2, 80)];

  it("off: no perk", () => {
    const outcome = settle(rows, { runnerUpPerk: "off" });

    expect(outcome.freePassIds).toEqual([1]);
    expect(outcome.halfPriceIds).toEqual([]);
  });

  it("half price", () => {
    const outcome = settle(rows, { runnerUpPerk: "half_price" });

    expect(outcome.freePassIds).toEqual([1]);
    expect(outcome.halfPriceIds).toEqual([2]);
  });
});

describe("late rule", () => {
  it("lose free pass: a late payer who finishes 2nd gets no pass", () => {
    const outcome = settleGameweek({
      rules: { ...DEFAULT_RULES, lateRule: "lose_free_pass" },
      rows: [row(1, 90), row(2, 80)],
      eligibleIds: [1, 2],
      latePayerIds: [2],
      pot: 200,
    });

    expect(outcome.runnerUpIds).toEqual([2]);
    expect(outcome.freePassIds).toEqual([1]);
  });
});

describe("manualOutcome", () => {
  it("splits the pot among the named winners and carries the rest", () => {
    const outcome = manualOutcome({ rules: DEFAULT_RULES, winnerIds: [1, 2, 3], runnerUpIds: [4], pot: 800 });

    expect(outcome.payouts.map((payout) => payout.amount)).toEqual([266, 266, 266]);
    expect(outcome.carryOut).toBe(2);
    expect(outcome.freePassIds).toEqual([1, 2, 3, 4]);
  });
});
