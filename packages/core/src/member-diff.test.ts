import { describe, expect, it } from "vitest";
import { diffMembers, type KnownMember } from "./member-diff.js";

const member = (fplEntryId: number, overrides: Partial<KnownMember> = {}): KnownMember => ({
  id: fplEntryId * 10,
  fplEntryId,
  fplTeamName: `Team ${fplEntryId}`,
  fplManagerName: `Manager ${fplEntryId}`,
  status: "active",
  ...overrides,
});
const manager = (entry: number, teamName = `Team ${entry}`, managerName = `Manager ${entry}`) => ({
  entry,
  teamName,
  managerName,
});

describe("diffMembers", () => {
  it("finds nothing when the league hasn't changed", () => {
    expect(diffMembers([member(1), member(2)], [manager(1), manager(2)])).toEqual({
      joined: [],
      left: [],
      rejoined: [],
      renamed: [],
    });
  });

  it("finds a new joiner", () => {
    expect(diffMembers([member(1)], [manager(1), manager(2)]).joined).toEqual([manager(2)]);
  });

  it("flags a leaver", () => {
    expect(diffMembers([member(1), member(2)], [manager(1)]).left).toEqual([member(2)]);
  });

  it("doesn't flag someone who already left again", () => {
    expect(diffMembers([member(1), member(2, { status: "left" })], [manager(1)]).left).toEqual([]);
  });

  it("flags a paused member who left", () => {
    expect(diffMembers([member(1, { status: "paused" })], [manager(2)]).left).toHaveLength(1);
  });

  it("brings back someone who rejoined, under any new name", () => {
    const result = diffMembers([member(1, { status: "left" })], [manager(1, "New Name")]);

    expect(result.rejoined.map((item) => item.fplEntryId)).toEqual([1]);
    expect(result.renamed).toEqual([{ id: 10, teamName: "New Name", managerName: "Manager 1" }]);
    expect(result.joined).toEqual([]);
  });

  it("doesn't touch a paused member who is still in the league", () => {
    const result = diffMembers([member(1, { status: "paused" })], [manager(1)]);

    expect(result.rejoined).toEqual([]);
    expect(result.left).toEqual([]);
  });

  it("picks up team and manager name changes", () => {
    expect(diffMembers([member(1)], [manager(1, "Renamed", "Also Renamed")]).renamed).toEqual([
      { id: 10, teamName: "Renamed", managerName: "Also Renamed" },
    ]);
  });

  it("treats an empty FPL list as bad data, so nobody is flagged", () => {
    expect(diffMembers([member(1), member(2)], [])).toEqual({ joined: [], left: [], rejoined: [], renamed: [] });
  });
});
