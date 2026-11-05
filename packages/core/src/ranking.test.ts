import { describe, expect, it } from "vitest";
import { netScore, rankGameweek } from "./ranking.js";

const row = (id: number, points: number, transferCost = 0) => ({ id, points, transferCost });

describe("netScore", () => {
  it("subtracts the transfer cost", () => {
    expect(netScore({ points: 52, transferCost: 8 })).toBe(44);
  });
});

describe("rankGameweek", () => {
  it("finds the winner, runner-up and last place by net score", () => {
    const result = rankGameweek([row(1, 60), row(2, 70), row(3, 50)]);

    expect(result.winnerIds).toEqual([2]);
    expect(result.runnerUpIds).toEqual([1]);
    expect(result.lastPlaceIds).toEqual([3]);
  });

  it("lets a hit change the order", () => {
    const result = rankGameweek([row(1, 70, 12), row(2, 60)]);

    expect(result.winnerIds).toEqual([2]);
    expect(result.runnerUpIds).toEqual([1]);
  });

  it("gives a 2-way tie for 1st to both, and the runner-up is the next distinct score", () => {
    const result = rankGameweek([row(1, 70), row(2, 70), row(3, 60), row(4, 50)]);

    expect(result.winnerIds).toEqual([1, 2]);
    expect(result.runnerUpIds).toEqual([3]);
  });

  it("handles a 3-way tie for 1st", () => {
    const result = rankGameweek([row(1, 70), row(2, 70), row(3, 70), row(4, 50)]);

    expect(result.winnerIds).toEqual([1, 2, 3]);
    expect(result.runnerUpIds).toEqual([4]);
  });

  it("handles 2-way and 3-way ties for 2nd", () => {
    expect(rankGameweek([row(1, 70), row(2, 60), row(3, 60)]).runnerUpIds).toEqual([2, 3]);
    expect(rankGameweek([row(1, 70), row(2, 60), row(3, 60), row(4, 60)]).runnerUpIds).toEqual([2, 3, 4]);
  });

  it("has no runner-up when everyone ties", () => {
    const result = rankGameweek([row(1, 70), row(2, 70)]);

    expect(result.winnerIds).toEqual([1, 2]);
    expect(result.runnerUpIds).toEqual([]);
  });

  it("returns empty results with nobody to rank", () => {
    expect(rankGameweek([])).toEqual({ standings: [], winnerIds: [], runnerUpIds: [], lastPlaceIds: [] });
  });

  it("gives tied managers the same rank in the standings", () => {
    const { standings } = rankGameweek([row(1, 60), row(2, 70), row(3, 70)]);

    expect(standings).toEqual([
      { id: 2, net: 70, rank: 1 },
      { id: 3, net: 70, rank: 1 },
      { id: 1, net: 60, rank: 3 },
    ]);
  });
});
