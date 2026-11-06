export interface SeasonWeek {
  winnerIds: number[];
  runnerUpIds: number[];
  payouts: { memberId: number; amount: number }[];
  /** Everyone with a score that gameweek. */
  playedIds: number[];
}

export interface MemberSeasonStats {
  memberId: number;
  played: number;
  wins: number;
  runnerUps: number;
  biggestWin: number;
  longestWinless: number;
  currentWinless: number;
}

/** Bragging rights from settled gameweeks, in order. Purely for fun, and nothing here touches money. */
export function seasonStats(weeks: SeasonWeek[]): MemberSeasonStats[] {
  const rows = new Map<number, MemberSeasonStats>();
  const rowFor = (memberId: number) => {
    const row = rows.get(memberId) ?? {
      memberId,
      played: 0,
      wins: 0,
      runnerUps: 0,
      biggestWin: 0,
      longestWinless: 0,
      currentWinless: 0,
    };
    rows.set(memberId, row);
    return row;
  };

  for (const week of weeks) {
    for (const memberId of week.playedIds) {
      const row = rowFor(memberId);
      row.played += 1;
      row.currentWinless = week.winnerIds.includes(memberId) ? 0 : row.currentWinless + 1;
      row.longestWinless = Math.max(row.longestWinless, row.currentWinless);
    }
    for (const memberId of week.winnerIds) rowFor(memberId).wins += 1;
    for (const memberId of week.runnerUpIds) rowFor(memberId).runnerUps += 1;
    for (const { memberId, amount } of week.payouts) {
      const row = rowFor(memberId);
      row.biggestWin = Math.max(row.biggestWin, amount);
    }
  }
  return [...rows.values()];
}
