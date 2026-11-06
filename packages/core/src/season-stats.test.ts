import { describe, expect, it } from "vitest";
import { seasonStats, type SeasonWeek } from "./season-stats.js";

const week = (overrides: Partial<SeasonWeek> = {}): SeasonWeek => ({
  winnerIds: [],
  runnerUpIds: [],
  payouts: [],
  playedIds: [1, 2],
  ...overrides,
});
const stats = (weeks: SeasonWeek[], id: number) => seasonStats(weeks).find((row) => row.memberId === id);

describe("seasonStats", () => {
  it("counts wins and runner-up finishes", () => {
    const weeks = [
      week({ winnerIds: [1], runnerUpIds: [2] }),
      week({ winnerIds: [1], runnerUpIds: [2] }),
      week({ winnerIds: [2], runnerUpIds: [1] }),
    ];

    expect(stats(weeks, 1)).toMatchObject({ wins: 2, runnerUps: 1 });
    expect(stats(weeks, 2)).toMatchObject({ wins: 1, runnerUps: 2 });
  });

  it("a shared win counts as a win for each", () => {
    expect(stats([week({ winnerIds: [1, 2] })], 2)?.wins).toBe(1);
  });

  it("finds the biggest single win", () => {
    const weeks = [
      week({ winnerIds: [1], payouts: [{ memberId: 1, amount: 900 }] }),
      week({ winnerIds: [1], payouts: [{ memberId: 1, amount: 450 }] }),
    ];

    expect(stats(weeks, 1)?.biggestWin).toBe(900);
    expect(stats(weeks, 2)?.biggestWin).toBe(0);
  });

  it("finds the longest run of gameweeks played without a win", () => {
    const weeks = [
      week({ winnerIds: [2] }),
      week({ winnerIds: [2] }),
      week({ winnerIds: [1] }),
      week({ winnerIds: [2] }),
    ];

    expect(stats(weeks, 1)?.longestWinless).toBe(2);
    expect(stats(weeks, 2)?.longestWinless).toBe(1);
  });

  it("a run still going counts, and gives the current run", () => {
    const weeks = [
      week({ winnerIds: [1] }),
      week({ winnerIds: [2] }),
      week({ winnerIds: [2] }),
      week({ winnerIds: [2] }),
    ];

    expect(stats(weeks, 1)).toMatchObject({ longestWinless: 3, currentWinless: 3 });
    expect(stats(weeks, 2)).toMatchObject({ longestWinless: 1, currentWinless: 0 });
  });

  it("a gameweek someone didn't play doesn't count against them, or break their run", () => {
    const weeks = [
      week({ winnerIds: [2], playedIds: [1, 2] }),
      week({ winnerIds: [2], playedIds: [2] }),
      week({ winnerIds: [2], playedIds: [1, 2] }),
    ];

    expect(stats(weeks, 1)).toMatchObject({ played: 2, longestWinless: 2 });
  });

  it("includes people with no results, and handles an empty season", () => {
    expect(seasonStats([])).toEqual([]);
    expect(stats([week({ winnerIds: [1], playedIds: [1, 2] })], 2)).toEqual({
      memberId: 2,
      played: 1,
      wins: 0,
      runnerUps: 0,
      biggestWin: 0,
      longestWinless: 1,
      currentWinless: 1,
    });
  });
});
