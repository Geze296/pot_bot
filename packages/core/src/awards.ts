export interface AwardInput {
  memberId: number;
  /** The score the league ranks by. */
  net: number;
  transferCost: number;
  benchPoints: number;
  /** The player who took the armband, after any auto-sub, and their points before doubling. */
  captain: { element: number; points: number } | null;
  /** Players on the pitch, with their points before any multiplier. */
  starters: { element: number; points: number }[];
  /** All 15 picks, because a differential means nobody else owned the player at all. */
  allPicks: number[];
}

export interface Award {
  memberIds: number[];
  value: number;
}

export interface PlayerAward extends Award {
  element: number;
}

export interface Awards {
  woodenSpoon: Award | null;
  benchBoss: Award | null;
  captainCalamity: PlayerAward | null;
  hitMan: Award | null;
  genius: PlayerAward | null;
}

function highest(inputs: AwardInput[], valueOf: (input: AwardInput) => number): Award | null {
  const top = Math.max(0, ...inputs.map(valueOf));
  if (top === 0) return null;
  return { memberIds: inputs.filter((input) => valueOf(input) === top).map((input) => input.memberId), value: top };
}

function woodenSpoon(inputs: AwardInput[]): Award | null {
  if (inputs.length === 0) return null;
  const value = Math.min(...inputs.map((input) => input.net));
  return { memberIds: inputs.filter((input) => input.net === value).map((input) => input.memberId), value };
}

function captainCalamity(inputs: AwardInput[]): PlayerAward | null {
  const withCaptain = inputs.flatMap((input) => (input.captain ? [{ ...input, captain: input.captain }] : []));
  if (withCaptain.length === 0) return null;
  const value = Math.min(...withCaptain.map((input) => input.captain.points));
  const worst = withCaptain.filter((input) => input.captain.points === value);
  return { memberIds: worst.map((input) => input.memberId), value, element: worst[0]!.captain.element };
}

function genius(inputs: AwardInput[]): PlayerAward | null {
  const owners = new Map<number, number>();
  for (const input of inputs) {
    for (const element of input.allPicks) owners.set(element, (owners.get(element) ?? 0) + 1);
  }
  const differentials = inputs.flatMap((input) =>
    input.starters
      .filter((starter) => owners.get(starter.element) === 1 && starter.points > 0)
      .map((starter) => ({ memberId: input.memberId, ...starter })),
  );
  if (differentials.length === 0) return null;
  const value = Math.max(...differentials.map((item) => item.points));
  const best = differentials.filter((item) => item.points === value);
  return { memberIds: best.map((item) => item.memberId), value, element: best[0]!.element };
}

/** Weekly awards. They're for fun and carry no money, so everyone with a score counts, paid or not. */
export function computeAwards(inputs: AwardInput[]): Awards {
  return {
    woodenSpoon: woodenSpoon(inputs),
    benchBoss: highest(inputs, (input) => input.benchPoints),
    captainCalamity: captainCalamity(inputs),
    hitMan: highest(inputs, (input) => input.transferCost),
    genius: genius(inputs),
  };
}
