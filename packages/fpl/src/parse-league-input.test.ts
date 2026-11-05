import { describe, expect, it } from "vitest";
import { parseLeagueInput } from "./parse-league-input.js";

describe("parseLeagueInput", () => {
  it.each([
    ["1680179", 1680179],
    ["  1680179 ", 1680179],
    ["https://fantasy.premierleague.com/leagues/1680179/standings/c", 1680179],
    ["https://fantasy.premierleague.com/en/leagues/1680179/standings/c", 1680179],
  ])("reads the league ID from %s", (input, leagueId) => {
    expect(parseLeagueInput(input)).toEqual({ kind: "id", leagueId });
  });

  it("recognises an invite link", () => {
    expect(parseLeagueInput("https://fantasy.premierleague.com/leagues/auto-join/iyrwt4")).toEqual({ kind: "invite" });
  });

  it.each(["", "iyrwt4", "league 12", "https://example.com"])("rejects %j", (input) => {
    expect(parseLeagueInput(input)).toEqual({ kind: "invalid" });
  });
});
