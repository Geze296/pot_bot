export interface ScoreRow {
  id: number;
  points: number;
  transferCost: number;
}

export interface Standing {
  id: number;
  net: number;
  rank: number;
}

export interface GameweekRanking {
  standings: Standing[];
  winnerIds: number[];
  runnerUpIds: number[];
  lastPlaceIds: number[];
}

/** FPL's gameweek `points` are before hits (locked against real data in packages/fpl), so the cost is subtracted. */
export function netScore(row: Pick<ScoreRow, "points" | "transferCost">): number {
  return row.points - row.transferCost;
}

/** Highest net score wins and ties share. The runner-up is the next distinct score after the winners. */
export function rankGameweek(rows: ScoreRow[]): GameweekRanking {
  const sorted = rows.map((row) => ({ id: row.id, net: netScore(row) })).sort((a, b) => b.net - a.net);

  const standings = sorted.map((row) => ({
    ...row,
    rank: sorted.findIndex((other) => other.net === row.net) + 1,
  }));

  const idsWithNet = (net: number | undefined) => standings.filter((row) => row.net === net).map((row) => row.id);
  const topNet = standings[0]?.net;
  const secondNet = standings.find((row) => row.net !== topNet)?.net;

  return {
    standings,
    winnerIds: idsWithNet(topNet),
    runnerUpIds: idsWithNet(secondNet),
    lastPlaceIds: idsWithNet(standings.at(-1)?.net),
  };
}
