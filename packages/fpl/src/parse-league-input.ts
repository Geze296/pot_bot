export type LeagueInput = { kind: "id"; leagueId: number } | { kind: "invite" } | { kind: "invalid" };

/** Reads what an owner pastes into /setup: an ID or a standings link. Invite links can't be read by the FPL API. */
export function parseLeagueInput(text: string): LeagueInput {
  const input = text.trim();
  if (input.includes("auto-join")) return { kind: "invite" };

  const digits = input.match(/leagues\/(\d+)/)?.[1] ?? input.match(/^\d+$/)?.[0];
  return digits ? { kind: "id", leagueId: Number(digits) } : { kind: "invalid" };
}
