import { describe, expect, it } from "vitest";
import { predictionStats, rightPredictors, type PredictionWeek } from "./predictions.js";

const vote = (voterId: number, pickedId: number) => ({ voterId, pickedId });

describe("predictionStats", () => {
  it("counts each vote, and the ones that picked the winner", () => {
    const weeks: PredictionWeek[] = [
      { winnerIds: [3], votes: [vote(1, 3), vote(2, 1)] },
      { winnerIds: [1], votes: [vote(1, 3), vote(2, 1)] },
    ];

    expect(predictionStats(weeks)).toEqual([
      { memberId: 1, predicted: 2, right: 1 },
      { memberId: 2, predicted: 2, right: 1 },
    ]);
  });

  it("a pick of any tied winner is right", () => {
    const weeks = [{ winnerIds: [3, 4], votes: [vote(1, 3), vote(2, 4), vote(5, 1)] }];

    expect(predictionStats(weeks)).toEqual([
      { memberId: 1, predicted: 1, right: 1 },
      { memberId: 2, predicted: 1, right: 1 },
      { memberId: 5, predicted: 1, right: 0 },
    ]);
  });

  it("a week with no winner doesn't count for anyone", () => {
    const weeks = [
      { winnerIds: [], votes: [vote(1, 3)] },
      { winnerIds: [3], votes: [vote(1, 3)] },
    ];

    expect(predictionStats(weeks)).toEqual([{ memberId: 1, predicted: 1, right: 1 }]);
  });

  it("puts the most right first, then the fewest tries", () => {
    const weeks = [
      { winnerIds: [9], votes: [vote(1, 9), vote(2, 9), vote(3, 8)] },
      { winnerIds: [9], votes: [vote(1, 8), vote(2, 9), vote(4, 9)] },
      { winnerIds: [9], votes: [vote(1, 8)] },
    ];

    expect(predictionStats(weeks).map((row) => row.memberId)).toEqual([2, 4, 1, 3]);
  });

  it("is empty when nobody voted", () => {
    expect(predictionStats([{ winnerIds: [1], votes: [] }])).toEqual([]);
    expect(predictionStats([])).toEqual([]);
  });
});

describe("rightPredictors", () => {
  it("lists who picked a winner that week, in vote order", () => {
    expect(rightPredictors({ winnerIds: [3, 4], votes: [vote(2, 4), vote(1, 3), vote(5, 1)] })).toEqual([2, 1]);
    expect(rightPredictors({ winnerIds: [], votes: [vote(1, 3)] })).toEqual([]);
  });
});
