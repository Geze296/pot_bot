import { describe, expect, it } from "vitest";
import { computeAwards, type AwardInput } from "./awards.js";

const pick = (element: number, points: number) => ({ element, points });
const manager = (memberId: number, overrides: Partial<AwardInput> = {}): AwardInput => ({
  memberId,
  net: 50,
  transferCost: 0,
  benchPoints: 0,
  captain: { element: 1000 + memberId, points: 5 },
  starters: [],
  allPicks: [],
  ...overrides,
});

describe("Wooden Spoon", () => {
  it("goes to the lowest net score, and ties share", () => {
    const awards = computeAwards([manager(1, { net: 30 }), manager(2, { net: 60 }), manager(3, { net: 30 })]);

    expect(awards.woodenSpoon).toEqual({ memberIds: [1, 3], value: 30 });
  });
});

describe("Bench Boss", () => {
  it("goes to the most points on the bench", () => {
    const awards = computeAwards([manager(1, { benchPoints: 4 }), manager(2, { benchPoints: 23 })]);

    expect(awards.benchBoss).toEqual({ memberIds: [2], value: 23 });
  });

  it("isn't awarded when nobody left points on the bench", () => {
    expect(computeAwards([manager(1), manager(2)]).benchBoss).toBeNull();
  });
});

describe("Captain Calamity", () => {
  it("goes to the worst captain, and names the player", () => {
    const awards = computeAwards([
      manager(1, { captain: { element: 10, points: 2 } }),
      manager(2, { captain: { element: 20, points: 14 } }),
    ]);

    expect(awards.captainCalamity).toEqual({ memberIds: [1], value: 2, element: 10 });
  });

  it("ties share, and a team with no captain data is left out", () => {
    const awards = computeAwards([
      manager(1, { captain: { element: 10, points: 2 } }),
      manager(2, { captain: { element: 20, points: 2 } }),
      manager(3, { captain: null }),
    ]);

    expect(awards.captainCalamity?.memberIds).toEqual([1, 2]);
  });

  it("isn't awarded with no captain data at all", () => {
    expect(computeAwards([manager(1, { captain: null })]).captainCalamity).toBeNull();
  });
});

describe("Hit Man", () => {
  it("goes to the most points spent on hits", () => {
    const awards = computeAwards([manager(1, { transferCost: 4 }), manager(2, { transferCost: 12 })]);

    expect(awards.hitMan).toEqual({ memberIds: [2], value: 12 });
  });

  it("isn't awarded when nobody took a hit", () => {
    expect(computeAwards([manager(1), manager(2)]).hitMan).toBeNull();
  });
});

describe("The Genius", () => {
  it("goes to the best starter nobody else owned", () => {
    const awards = computeAwards([
      manager(1, { starters: [pick(10, 12), pick(11, 15)], allPicks: [10, 11] }),
      manager(2, { starters: [pick(11, 15), pick(12, 8)], allPicks: [11, 12] }),
    ]);

    expect(awards.genius).toEqual({ memberIds: [1], value: 12, element: 10 });
  });

  it("ignores a player someone else had, even on their bench", () => {
    const awards = computeAwards([
      manager(1, { starters: [pick(10, 20)], allPicks: [10] }),
      manager(2, { starters: [pick(12, 3)], allPicks: [10, 12] }),
    ]);

    expect(awards.genius).toEqual({ memberIds: [2], value: 3, element: 12 });
  });

  it("isn't awarded for a differential who scored nothing", () => {
    const awards = computeAwards([manager(1, { starters: [pick(10, 0)], allPicks: [10] })]);

    expect(awards.genius).toBeNull();
  });

  it("two differentials on the same points share, with the first named", () => {
    const awards = computeAwards([
      manager(1, { starters: [pick(10, 9)], allPicks: [10] }),
      manager(2, { starters: [pick(12, 9)], allPicks: [12] }),
    ]);

    expect(awards.genius?.memberIds).toEqual([1, 2]);
    expect(awards.genius?.value).toBe(9);
  });
});

describe("computeAwards", () => {
  it("handles nobody at all", () => {
    expect(computeAwards([])).toEqual({
      woodenSpoon: null,
      benchBoss: null,
      captainCalamity: null,
      hitMan: null,
      genius: null,
    });
  });
});
